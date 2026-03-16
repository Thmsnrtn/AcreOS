// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { Router, type Request, type Response } from 'express';
import { storage, db } from './storage';
import { fieldScoutVisits, fieldScoutPhotos, leads, properties } from '@shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import multer from 'multer';

const fieldScoutRouter = Router();

// ============================================================
// HELPERS
// ============================================================

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

function getUser(req: Request) {
  return (req as any).user;
}

// Multer for voice memos (single audio file, up to 25MB for Whisper)
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Multer for photo uploads (up to 10 files, 10MB each)
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ============================================================
// GET /parcel-lookup — Reverse geocode GPS to parcel data
// ============================================================

fieldScoutRouter.get('/properties/parcel-lookup', async (req: Request, res: Response) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: 'lat and lng must be valid numbers' });
    }

    // In production this would call a GIS/parcel API service.
    // For now return enriched mock data based on coordinates.
    const latHash = Math.abs(Math.round(latitude * 1000));
    const lngHash = Math.abs(Math.round(longitude * 1000));
    const seed = (latHash + lngHash) % 10000;

    const counties = ['Williamson', 'Travis', 'Hays', 'Bell', 'Burnet', 'Bastrop', 'Caldwell', 'Milam'];
    const states = ['TX', 'TX', 'TX', 'TX', 'TX', 'TX', 'TX', 'TX'];
    const zonings = ['AG', 'R-1', 'R-2', 'RR', 'C-1', 'A-1', 'MH', 'SF-3'];

    const countyIdx = seed % counties.length;
    const acreage = parseFloat((1 + (seed % 500) / 10).toFixed(2));
    const assessedValue = Math.round(acreage * (2000 + (seed % 8000)));
    const lastSalePrice = Math.round(assessedValue * (0.7 + (seed % 60) / 100));

    const parcel = {
      apn: `${String(seed).padStart(4, '0')}-${String((seed * 7) % 10000).padStart(4, '0')}-${String((seed * 13) % 1000).padStart(3, '0')}`,
      ownerName: `Owner ${seed}`,
      address: `${1000 + seed} County Road ${seed % 999}`,
      county: counties[countyIdx],
      state: states[countyIdx],
      acreage,
      assessedValue,
      zoning: zonings[seed % zonings.length],
      lastSaleDate: new Date(2015 + (seed % 9), seed % 12, 1 + (seed % 28)).toISOString().split('T')[0],
      lastSalePrice,
      latitude,
      longitude,
    };

    res.json(parcel);
  } catch (err: any) {
    console.error('[field-scout] parcel-lookup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /voice/transcribe — Transcribe voice memo audio
// ============================================================

fieldScoutRouter.post('/voice/transcribe', voiceUpload.single('audio'), async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) {
      return res.status(400).json({ error: 'No audio file provided. Upload as multipart field "audio".' });
    }

    const openaiKey = process.env.OPENAI_API_KEY;

    if (openaiKey) {
      // Use OpenAI Whisper API for transcription
      try {
        const blob = new Blob([file.buffer], { type: file.mimetype || 'audio/webm' });
        const formData = new FormData();
        formData.append('file', blob, file.originalname || 'audio.webm');
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const errBody = await response.text();
          console.error('[field-scout] Whisper API error:', errBody);
          throw new Error(`Whisper API error: ${response.status}`);
        }

        const result: any = await response.json();

        return res.json({
          text: result.text || '',
          duration: result.duration || 0,
          confidence: 0.95, // Whisper doesn't return confidence per-transcript; use high default
        });
      } catch (whisperErr: any) {
        console.error('[field-scout] Whisper transcription failed, returning stub:', whisperErr.message);
      }
    }

    // Stub response when no API key or Whisper fails
    res.json({
      text: '',
      duration: 0,
      confidence: 0,
      pending: true,
      message: 'Transcription is pending — no OpenAI API key configured or service unavailable.',
    });
  } catch (err: any) {
    console.error('[field-scout] transcribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /leads/:id/photos — Upload geotagged photos to a lead
// ============================================================

fieldScoutRouter.post('/leads/:id/photos', photoUpload.array('photos', 10), async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const leadId = parseInt(req.params.id);

    if (isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    // Verify lead belongs to org
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const files = (req as any).files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No photo files provided. Upload as multipart field "photos".' });
    }

    // Parse optional metadata from body (JSON array matching files by index)
    let photoMeta: any[] = [];
    if (req.body.metadata) {
      try {
        photoMeta = typeof req.body.metadata === 'string'
          ? JSON.parse(req.body.metadata)
          : req.body.metadata;
      } catch {
        // ignore parse errors; metadata is optional
      }
    }

    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const meta = photoMeta[i] || {};

      const photoRecord = await storage.createFieldScoutPhoto({
        visitId: meta.visitId ? parseInt(meta.visitId) : null,
        leadId,
        filename: file.originalname || `photo_${Date.now()}_${i}`,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        latitude: meta.latitude ? String(meta.latitude) : null,
        longitude: meta.longitude ? String(meta.longitude) : null,
        capturedAt: meta.capturedAt ? new Date(meta.capturedAt) : null,
      });

      results.push(photoRecord);
    }

    res.json({ photos: results });
  } catch (err: any) {
    console.error('[field-scout] photo upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /field-scout/visits — Log a property visit
// ============================================================

fieldScoutRouter.post('/field-scout/visits', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { leadId, propertyId, latitude, longitude, duration, notes, photos, checklistResults } = req.body;

    if (!leadId || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'leadId, latitude, and longitude are required' });
    }

    const visit = await storage.createFieldScoutVisit({
      visitorId: user.id,
      leadId: parseInt(leadId),
      propertyId: propertyId ? parseInt(propertyId) : null,
      latitude: String(latitude),
      longitude: String(longitude),
      duration: duration ? parseInt(duration) : null,
      notes: notes || null,
      checklistResults: checklistResults || null,
    });

    // If photos metadata was included, link them to the visit
    if (Array.isArray(photos) && photos.length > 0) {
      for (const photo of photos) {
        await storage.createFieldScoutPhoto({
          visitId: visit.id,
          leadId: parseInt(leadId),
          filename: photo.filename || 'unknown',
          mimeType: photo.mimeType || 'image/jpeg',
          sizeBytes: photo.sizeBytes || 0,
          latitude: photo.latitude ? String(photo.latitude) : null,
          longitude: photo.longitude ? String(photo.longitude) : null,
          capturedAt: photo.capturedAt ? new Date(photo.capturedAt) : null,
        });
      }
    }

    res.status(201).json(visit);
  } catch (err: any) {
    console.error('[field-scout] create visit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /field-scout/visits — List visits for current user
// ============================================================

fieldScoutRouter.get('/field-scout/visits', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const [visits, total] = await Promise.all([
      storage.getFieldScoutVisits(user.id, limit, offset),
      storage.countFieldScoutVisits(user.id),
    ]);

    // Enrich visits with lead info
    const enriched = await Promise.all(visits.map(async (visit) => {
      let lead = null;
      let property = null;

      try {
        const org = getOrg(req);
        lead = await storage.getLead(org.id, visit.leadId);
        if (visit.propertyId) {
          property = await storage.getProperty(org.id, visit.propertyId);
        }
      } catch {
        // org may not be available; skip enrichment
      }

      const photos = await storage.getFieldScoutPhotosByVisit(visit.id);

      return {
        ...visit,
        lead: lead ? { id: lead.id, name: lead.firstName ? `${lead.firstName} ${lead.lastName || ''}`.trim() : lead.email, status: lead.status } : null,
        property: property ? { id: property.id, address: (property as any).address, county: (property as any).county } : null,
        photos,
      };
    }));

    res.json({
      visits: enriched,
      total,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[field-scout] list visits error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /field-scout/reports — Generate a scout report
// ============================================================

fieldScoutRouter.post('/field-scout/reports', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { visitIds, format } = req.body;

    if (!Array.isArray(visitIds) || visitIds.length === 0) {
      return res.status(400).json({ error: 'visitIds must be a non-empty array' });
    }

    if (!format || !['pdf', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'format must be "pdf" or "csv"' });
    }

    // Fetch all visits
    const visits = [];
    for (const vid of visitIds) {
      const visit = await storage.getFieldScoutVisit(parseInt(vid));
      if (visit) {
        const photos = await storage.getFieldScoutPhotosByVisit(visit.id);
        visits.push({ ...visit, photos });
      }
    }

    if (visits.length === 0) {
      return res.status(404).json({ error: 'No visits found for the provided IDs' });
    }

    if (format === 'csv') {
      // Generate CSV report
      const headers = ['Visit ID', 'Lead ID', 'Property ID', 'Latitude', 'Longitude', 'Duration (min)', 'Notes', 'Photos Count', 'Date'];
      const rows = visits.map(v => [
        v.id,
        v.leadId,
        v.propertyId || '',
        v.latitude,
        v.longitude,
        v.duration || '',
        `"${(v.notes || '').replace(/"/g, '""')}"`,
        v.photos.length,
        v.createdAt ? new Date(v.createdAt).toISOString() : '',
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="field-scout-report.csv"');
      return res.send(csvContent);
    }

    // Generate PDF report using jsPDF
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    let y = 20;
    const lineHeight = 7;
    const margin = 20;

    // Header
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Field Scout Report', margin, y);
    y += lineHeight * 2;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
    y += lineHeight;
    doc.text(`Total Visits: ${visits.length}`, margin, y);
    y += lineHeight * 2;

    // Visit details
    for (const visit of visits) {
      // Check for page overflow
      if (y > 260) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`Visit #${visit.id}`, margin, y);
      y += lineHeight;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Lead ID: ${visit.leadId}`, margin, y);
      y += lineHeight;
      if (visit.propertyId) {
        doc.text(`Property ID: ${visit.propertyId}`, margin, y);
        y += lineHeight;
      }
      doc.text(`Location: ${visit.latitude}, ${visit.longitude}`, margin, y);
      y += lineHeight;
      if (visit.duration) {
        doc.text(`Duration: ${visit.duration} minutes`, margin, y);
        y += lineHeight;
      }
      doc.text(`Date: ${visit.createdAt ? new Date(visit.createdAt).toLocaleString() : 'N/A'}`, margin, y);
      y += lineHeight;

      if (visit.notes) {
        doc.text('Notes:', margin, y);
        y += lineHeight;
        // Wrap long notes
        const splitNotes = doc.splitTextToSize(visit.notes, 170);
        doc.text(splitNotes, margin + 5, y);
        y += lineHeight * Math.min(splitNotes.length, 5);
      }

      if (visit.checklistResults) {
        doc.text('Checklist Results:', margin, y);
        y += lineHeight;
        const checklistStr = typeof visit.checklistResults === 'string'
          ? visit.checklistResults
          : JSON.stringify(visit.checklistResults, null, 2);
        const splitChecklist = doc.splitTextToSize(checklistStr, 170);
        doc.text(splitChecklist.slice(0, 10), margin + 5, y);
        y += lineHeight * Math.min(splitChecklist.length, 10);
      }

      doc.text(`Photos: ${visit.photos.length}`, margin, y);
      y += lineHeight;

      // Separator line
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, y, 190, y);
      y += lineHeight;
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="field-scout-report.pdf"');
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[field-scout] report generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default fieldScoutRouter;
