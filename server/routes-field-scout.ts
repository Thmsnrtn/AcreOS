import { Router, type Request, type Response } from 'express';
import { storage, db } from './storage';
import { fieldScoutVisits, fieldScoutPhotos, leads, properties } from '@shared/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { createUploadMiddleware, validateFileMiddleware } from "./middleware/fileUploadSecurity";
// Phase 8 Mo 12 — Yara §1: EXIF strip + SHA-256 hash + resize variants.
import { processUploadedImage } from "./services/imagePipeline";

const fieldScoutRouter = Router();

// ============================================================
// HELPERS
// ============================================================


function getUser(req: Request) {
  return req.user;
}

// Secure multer for voice memos (single audio file, up to 25MB for Whisper)
const voiceUpload = createUploadMiddleware({ maxSizeMB: 25 });

// Secure multer for photo uploads (up to 10 files, 10MB each)
const photoUpload = createUploadMiddleware({ maxSizeMB: 10, allowedTypes: ["image"] });
const validatePhotos = validateFileMiddleware(["image"]);

// ============================================================
// GET /parcel-lookup — Reverse geocode GPS to parcel data
// ============================================================

fieldScoutRouter.get('/properties/parcel-lookup', async (req: Request, res: Response) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return Errors.badRequest(res, 'lat and lng query parameters are required');
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);

    if (isNaN(latitude) || isNaN(longitude)) {
      return Errors.badRequest(res, 'lat and lng must be valid numbers');
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
    logger.error('[field-scout] parcel-lookup error', err);
    return Errors.internal(res, err);
  }
});

// ============================================================
// POST /voice/transcribe — Transcribe voice memo audio
// ============================================================

fieldScoutRouter.post('/voice/transcribe', voiceUpload.single('audio'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return Errors.badRequest(res, 'No audio file provided. Upload as multipart field "audio".');
    }

    const openaiKey = process.env.OPENAI_API_KEY;

    if (openaiKey) {
      // Use OpenAI Whisper API for transcription
      try {
        const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'audio/webm' });
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
          logger.error('[field-scout] Whisper API error', undefined, { metadata: { detail: errBody } });
          throw new Error(`Whisper API error: ${response.status}`);
        }

        const result: any = await response.json();

        return res.json({
          text: result.text || '',
          duration: result.duration || 0,
          confidence: 0.95, // Whisper doesn't return confidence per-transcript; use high default
        });
      } catch (whisperErr: any) {
        logger.error('[field-scout] Whisper transcription failed, returning stub', undefined, { metadata: { detail: whisperErr.message } });
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
    logger.error('[field-scout] transcribe error', err);
    return Errors.internal(res, err);
  }
});

// ============================================================
// POST /leads/:id/photos — Upload geotagged photos to a lead
// ============================================================

fieldScoutRouter.post('/leads/:id/photos', photoUpload.array('photos', 10), validatePhotos, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const leadId = parseInt(req.params.id);

    if (isNaN(leadId)) {
      return Errors.badRequest(res, 'Invalid lead ID');
    }

    // Verify lead belongs to org
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return Errors.notFound(res, 'Lead');
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return Errors.badRequest(res, 'No photo files provided. Upload as multipart field "photos".');
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
    const dedupedHashes: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const meta = photoMeta[i] || {};

      // Phase 8 Mo 12 — Yara §1: EXIF strip + SHA-256 + resize.
      // The validateFileMiddleware above already ran a JPEG-only marker
      // walker for defense-in-depth; re-running through sharp here gives
      // us non-JPEG support, baked-in orientation, the dedup hash, and
      // the resize variants in one pass.
      let processed: Awaited<ReturnType<typeof processUploadedImage>> | null = null;
      try {
        processed = await processUploadedImage(file.buffer, file.mimetype || "image/jpeg");
      } catch (err) {
        logger.warn(`[field-scout] image pipeline failed for ${file.originalname}; storing raw`, {
          metadata: { error: (err as Error).message },
        });
      }

      const imageHash = processed?.hash ?? null;

      // Reverse-image dedup — if this org has uploaded the exact same image
      // before, return the existing record's URLs instead of re-storing.
      if (imageHash) {
        const existing = await storage.findFieldScoutPhotoByHash(org.id, imageHash);
        if (existing) {
          dedupedHashes.push(imageHash);
          results.push(existing);
          continue;
        }
      }

      // TODO(Wave 10 blob-storage): once the S3/R2 client lands per
      // docs/cost/blob-storage-migration.md, upload `processed.variants.*`
      // and use the returned URLs here. For now we persist the hash + sizes
      // so the dedup table is populated; URL points to a placeholder data
      // path the surface API will resolve at read time.
      const filename = (file.originalname || `photo_${Date.now()}_${i}`).replace(/[^a-zA-Z0-9._-]/g, "_");

      const photoRecord = await storage.createFieldScoutPhoto({
        organizationId: org.id,
        visitId: meta.visitId ? parseInt(meta.visitId) : 0,
        leadId,
        url: `/uploads/field-scout/${imageHash || filename}`,
        caption: meta.caption ?? null,
        latitude: meta.latitude != null ? Number(meta.latitude) : null,
        longitude: meta.longitude != null ? Number(meta.longitude) : null,
        imageHash,
        thumbnailUrl: imageHash ? `/uploads/field-scout/${imageHash}/thumbnail.jpg` : null,
        cardUrl: imageHash ? `/uploads/field-scout/${imageHash}/card.jpg` : null,
        fullUrl: imageHash ? `/uploads/field-scout/${imageHash}/full.jpg` : null,
        bytes: processed?.stripped.length ?? file.size,
        mime: file.mimetype ?? null,
      });

      results.push(photoRecord);
    }

    res.json({ photos: results, deduped: dedupedHashes });
  } catch (err: any) {
    logger.error('[field-scout] photo upload error', err);
    return Errors.internal(res, err);
  }
});

// ============================================================
// POST /field-scout/visits — Log a property visit
// ============================================================

fieldScoutRouter.post('/field-scout/visits', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return Errors.unauthorized(res);
    }

    const org = req.organization;
    const { leadId, propertyId, latitude, longitude, notes, photos } = req.body;

    if (!leadId || latitude == null || longitude == null) {
      return Errors.badRequest(res, 'leadId, latitude, and longitude are required');
    }

    const visit = await storage.createFieldScoutVisit({
      organizationId: org.id,
      visitorId: user.id,
      leadId: parseInt(leadId),
      propertyId: propertyId ? parseInt(propertyId) : null,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      notes: notes || null,
    });

    // If photos metadata was included, link them to the visit. Image
    // payloads (with EXIF strip + hash + variants) are uploaded via
    // POST /leads/:id/photos — this path only records pointer metadata
    // for previously uploaded photos.
    if (Array.isArray(photos) && photos.length > 0) {
      for (const photo of photos) {
        await storage.createFieldScoutPhoto({
          organizationId: org.id,
          visitId: visit.id,
          leadId: parseInt(leadId),
          url: photo.url || photo.filename || 'unknown',
          caption: photo.caption ?? null,
          latitude: photo.latitude != null ? Number(photo.latitude) : null,
          longitude: photo.longitude != null ? Number(photo.longitude) : null,
          imageHash: photo.imageHash ?? null,
          thumbnailUrl: photo.thumbnailUrl ?? null,
          cardUrl: photo.cardUrl ?? null,
          fullUrl: photo.fullUrl ?? null,
          bytes: photo.sizeBytes ?? null,
          mime: photo.mimeType ?? null,
        });
      }
    }

    res.status(201).json(visit);
  } catch (err: any) {
    logger.error('[field-scout] create visit error', err);
    return Errors.internal(res, err);
  }
});

// ============================================================
// GET /field-scout/visits — List visits for current user
// ============================================================

fieldScoutRouter.get('/field-scout/visits', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return Errors.unauthorized(res);
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
        const org = req.organization;
        if (visit.leadId != null) {
          lead = await storage.getLead(org.id, visit.leadId);
        }
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
    logger.error('[field-scout] list visits error', err);
    return Errors.internal(res, err);
  }
});

// ============================================================
// POST /field-scout/reports — Generate a scout report
// ============================================================

fieldScoutRouter.post('/field-scout/reports', async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    if (!user) {
      return Errors.unauthorized(res);
    }

    const { visitIds, format } = req.body;

    if (!Array.isArray(visitIds) || visitIds.length === 0) {
      return Errors.badRequest(res, 'visitIds must be a non-empty array');
    }

    if (!format || !['pdf', 'csv'].includes(format)) {
      return Errors.badRequest(res, 'format must be "pdf" or "csv"');
    }

    // Fetch all visits
    // 2026-06-10 (T0-2 sweep): only export this org's visits — a foreign
    // visitId is silently skipped (router is mounted behind getOrCreateOrg).
    const org = req.organization;
    const visits = [];
    for (const vid of visitIds) {
      const visit = await storage.getFieldScoutVisit(parseInt(vid));
      if (visit && visit.organizationId === org.id) {
        const photos = await storage.getFieldScoutPhotosByVisit(visit.id);
        visits.push({ ...visit, photos });
      }
    }

    if (visits.length === 0) {
      return Errors.notFound(res, 'Visits');
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
        // TODO(tsc): field_scout_visits has no duration column.
        '',
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
      // TODO(tsc): field_scout_visits has no duration column to render here.
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

      // TODO(tsc): field_scout_visits has no checklistResults column to render.

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
    logger.error('[field-scout] report generation error', err);
    return Errors.internal(res, err);
  }
});

export default fieldScoutRouter;
