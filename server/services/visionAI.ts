import { db } from '../db';
import { 
  propertyPhotos, 
  photoAnalysis,
  satelliteSnapshots,
  properties 
} from '../../shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface PhotoAnalysisResult {
  detectedFeatures: string[];
  landscapeType: string;
  buildingDetected: boolean;
  roadDetected: boolean;
  waterDetected: boolean;
  photoQuality: string;
  isUsableForMarketing: boolean;
  aiDescription: string;
  estimatedAcreageVisible: number | null;
  vegetationDensity: number;
  confidence: number;
}

interface SatelliteChangeDetection {
  changeDetected: boolean;
  changeType: string | null;
  changeSeverity: string | null;
  changedAreas: { lat: number; lng: number; size: number }[];
  confidence: number;
}

class VisualIntelligence {
  /**
   * Analyze property photo using OpenAI Vision API
   */
  async analyzePhoto(
    organizationId: string,
    photoId: number,
    imageUrl: string
  ): Promise<PhotoAnalysisResult> {
    try {
      const photo = await db.query.propertyPhotos.findFirst({
        where: eq(propertyPhotos.id, photoId),
      });

      if (!photo) {
        throw new Error('Photo not found');
      }

      // Call OpenAI Vision API
      const prompt = `Analyze this land/property photo in detail. Provide:
1. List all detected features (trees, grass, roads, buildings, water, fences, etc.)
2. Landscape type (forest, grassland, desert, mixed, mountainous, etc.)
3. Are there any buildings visible? (yes/no)
4. Are there any roads visible? (yes/no)
5. Is water visible (river, lake, pond)? (yes/no)
6. Photo quality assessment (excellent, good, fair, poor)
7. Is this photo usable for marketing? (yes/no)
8. Provide a detailed description (2-3 sentences) suitable for a real estate listing
9. Estimate how many acres are visible in the photo (null if can't determine)
10. Estimate vegetation density as a percentage (0-100)

Respond in JSON format with keys: features (array), landscapeType, buildingDetected (boolean), roadDetected (boolean), waterDetected (boolean), photoQuality, isUsableForMarketing (boolean), description, estimatedAcres (number or null), vegetationDensity (number 0-100)`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const responseText = completion.choices[0].message.content || '{}';
      const analysis = this.parseVisionResponse(responseText);

      // Save analysis to database
      const [savedAnalysis] = await db.insert(photoAnalysis).values({
        photoId: photo.id,
        propertyId: photo.propertyId,
        detectedFeatures: analysis.detectedFeatures,
        landscapeType: analysis.landscapeType,
        buildingDetected: analysis.buildingDetected,
        roadDetected: analysis.roadDetected,
        waterDetected: analysis.waterDetected,
        photoQuality: analysis.photoQuality,
        isUsableForMarketing: analysis.isUsableForMarketing,
        aiDescription: analysis.aiDescription,
        estimatedAcreageVisible: analysis.estimatedAcreageVisible,
        vegetationDensity: analysis.vegetationDensity,
        modelVersion: 'gpt-4-vision-preview',
        confidence: analysis.confidence,
      }).returning();

      // Update photo to mark as analyzed
      await db.update(propertyPhotos)
        .set({ 
          hasAnalysis: true,
          analysisId: savedAnalysis.id,
        })
        .where(eq(propertyPhotos.id, photoId));

      return analysis;
    } catch (error) {
      console.error('Photo analysis failed:', error);
      throw error;
    }
  }

  /**
   * Parse Vision API response
   */
  private parseVisionResponse(response: string): PhotoAnalysisResult {
    try {
      // Try to parse as JSON
      const json = JSON.parse(response);
      
      return {
        detectedFeatures: json.features || [],
        landscapeType: json.landscapeType || 'unknown',
        buildingDetected: json.buildingDetected || false,
        roadDetected: json.roadDetected || false,
        waterDetected: json.waterDetected || false,
        photoQuality: json.photoQuality || 'fair',
        isUsableForMarketing: json.isUsableForMarketing || false,
        aiDescription: json.description || 'No description available',
        estimatedAcreageVisible: json.estimatedAcres || null,
        vegetationDensity: json.vegetationDensity || 50,
        confidence: 75, // Default confidence
      };
    } catch (error) {
      // If not valid JSON, try to extract info from text
      return {
        detectedFeatures: [],
        landscapeType: 'unknown',
        buildingDetected: false,
        roadDetected: false,
        waterDetected: false,
        photoQuality: 'fair',
        isUsableForMarketing: false,
        aiDescription: response.substring(0, 500),
        estimatedAcreageVisible: null,
        vegetationDensity: 50,
        confidence: 50,
      };
    }
  }

  /**
   * Analyze all photos for a property
   */
  async analyzePropertyPhotos(
    organizationId: string,
    propertyId: number
  ): Promise<{ analyzed: number; failed: number }> {
    try {
      const photos = await db.query.propertyPhotos.findMany({
        where: and(
          eq(propertyPhotos.propertyId, propertyId),
          eq(propertyPhotos.hasAnalysis, false)
        ),
      });

      let analyzed = 0;
      let failed = 0;

      for (const photo of photos) {
        try {
          await this.analyzePhoto(organizationId, photo.id, photo.url);
          analyzed++;
        } catch (error) {
          failed++;
          console.error(`Failed to analyze photo ${photo.id}:`, error);
        }
      }

      return { analyzed, failed };
    } catch (error) {
      console.error('Property photo analysis failed:', error);
      throw error;
    }
  }

  /**
   * Get best marketing photo for property
   */
  async getBestMarketingPhoto(propertyId: number): Promise<any | null> {
    try {
      const analyses = await db.query.photoAnalysis.findMany({
        where: and(
          eq(photoAnalysis.propertyId, propertyId),
          eq(photoAnalysis.isUsableForMarketing, true)
        ),
      });

      if (analyses.length === 0) return null;

      // Score photos based on quality, features, and composition
      const scored = analyses.map(a => {
        let score = 0;

        // Quality
        if (a.photoQuality === 'excellent') score += 40;
        else if (a.photoQuality === 'good') score += 30;
        else if (a.photoQuality === 'fair') score += 15;

        // Features
        score += (a.detectedFeatures as string[]).length * 5;

        // Water is highly desirable
        if (a.waterDetected) score += 20;

        // Buildings can be good or bad depending on context
        if (a.buildingDetected) score += 10;

        // Confidence
        score += (a.confidence / 100) * 20;

        return { ...a, score };
      });

      // Sort by score
      scored.sort((a, b) => b.score - a.score);

      // Get the photo details
      const bestAnalysis = scored[0];
      const photo = await db.query.propertyPhotos.findFirst({
        where: eq(propertyPhotos.id, bestAnalysis.photoId),
      });

      return {
        ...photo,
        analysis: bestAnalysis,
      };
    } catch (error) {
      console.error('Failed to get best marketing photo:', error);
      return null;
    }
  }

  /**
   * Generate property description from photos
   */
  async generatePropertyDescription(propertyId: number): Promise<string> {
    try {
      const analyses = await db.query.photoAnalysis.findMany({
        where: eq(photoAnalysis.propertyId, propertyId),
        orderBy: [desc(photoAnalysis.confidence)],
        limit: 5, // Use top 5 photos
      });

      if (analyses.length === 0) {
        return 'No photo analysis available for this property.';
      }

      // Combine descriptions
      const descriptions = analyses.map(a => a.aiDescription).filter(d => d);

      // Use GPT-4 to synthesize a cohesive description
      const prompt = `Based on these descriptions of a land property from multiple photos, create a single cohesive, compelling property description (3-4 sentences) suitable for a real estate listing:

${descriptions.join('\n\n')}

Create a flowing description that highlights the best features without repeating information.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });

      return completion.choices[0].message.content || descriptions[0];
    } catch (error) {
      console.error('Failed to generate property description:', error);
      return 'Property description generation failed.';
    }
  }

  /**
   * Capture satellite snapshot for property
   */
  async captureSatelliteSnapshot(
    propertyId: number,
    imageUrl: string,
    provider: string = 'google'
  ): Promise<number> {
    try {
      const property = await db.query.properties.findFirst({
        where: eq(properties.id, propertyId),
      });

      if (!property) {
        throw new Error('Property not found');
      }

      const [snapshot] = await db.insert(satelliteSnapshots).values({
        propertyId,
        imageUrl,
        provider,
        resolution: 1.0, // meters per pixel (approximate for Google Maps)
        captureDate: new Date(),
        cloudCoverage: 0, // Would be detected from image
        changeDetected: false,
      }).returning();

      return snapshot.id;
    } catch (error) {
      console.error('Failed to capture satellite snapshot:', error);
      throw error;
    }
  }

  /**
   * Compare two satellite snapshots for change detection
   */
  async detectChanges(
    snapshotId1: number,
    snapshotId2: number
  ): Promise<SatelliteChangeDetection> {
    try {
      const [snapshot1, snapshot2] = await Promise.all([
        db.query.satelliteSnapshots.findFirst({
          where: eq(satelliteSnapshots.id, snapshotId1),
        }),
        db.query.satelliteSnapshots.findFirst({
          where: eq(satelliteSnapshots.id, snapshotId2),
        }),
      ]);

      if (!snapshot1 || !snapshot2) {
        throw new Error('Snapshots not found');
      }

      // Call OpenAI Vision API to compare images
      const prompt = `Compare these two satellite images of the same property taken at different times. Identify:
1. Have there been any significant changes? (yes/no)
2. If yes, what type of change? (vegetation, construction, clearing, water_level, other)
3. How severe is the change? (minor, moderate, major)
4. Describe the changes in detail

Respond in JSON format with keys: changeDetected (boolean), changeType, changeSeverity, description`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: snapshot1.imageUrl } },
              { type: 'image_url', image_url: { url: snapshot2.imageUrl } },
            ],
          },
        ],
        max_tokens: 500,
      });

      const response = completion.choices[0].message.content || '{}';
      const analysis = JSON.parse(response);

      // Update snapshot with change detection results
      await db.update(satelliteSnapshots)
        .set({
          changeDetected: analysis.changeDetected || false,
          changeType: analysis.changeType || null,
          changeSeverity: analysis.changeSeverity || null,
          comparedToSnapshotId: snapshotId1,
        })
        .where(eq(satelliteSnapshots.id, snapshotId2));

      return {
        changeDetected: analysis.changeDetected || false,
        changeType: analysis.changeType || null,
        changeSeverity: analysis.changeSeverity || null,
        changedAreas: [], // Would extract from detailed analysis
        confidence: 70,
      };
    } catch (error) {
      console.error('Change detection failed:', error);
      throw error;
    }
  }

  /**
   * Get all snapshots for property
   */
  async getPropertySnapshots(propertyId: number): Promise<any[]> {
    try {
      return await db.query.satelliteSnapshots.findMany({
        where: eq(satelliteSnapshots.propertyId, propertyId),
        orderBy: [desc(satelliteSnapshots.captureDate)],
      });
    } catch (error) {
      console.error('Failed to get property snapshots:', error);
      return [];
    }
  }

  /**
   * Find similar properties by photo features
   */
  async findSimilarProperties(
    propertyId: number,
    limit: number = 10
  ): Promise<number[]> {
    try {
      // Get all photo analyses for this property
      const targetAnalyses = await db.query.photoAnalysis.findMany({
        where: eq(photoAnalysis.propertyId, propertyId),
      });

      if (targetAnalyses.length === 0) return [];

      // Extract key features
      const targetFeatures = new Set<string>();
      const targetLandscapes = new Set<string>();
      
      for (const analysis of targetAnalyses) {
        (analysis.detectedFeatures as string[]).forEach(f => targetFeatures.add(f));
        if (analysis.landscapeType) targetLandscapes.add(analysis.landscapeType);
      }

      // Get all other property analyses
      const allAnalyses = await db.query.photoAnalysis.findMany({
        where: sql`${photoAnalysis.propertyId} != ${propertyId}`,
      });

      // Score similarity
      const propertyScores = new Map<number, number>();

      for (const analysis of allAnalyses) {
        const propId = analysis.propertyId;
        let score = propertyScores.get(propId) || 0;

        // Feature similarity
        const features = analysis.detectedFeatures as string[];
        const commonFeatures = features.filter(f => targetFeatures.has(f));
        score += commonFeatures.length * 10;

        // Landscape similarity
        if (analysis.landscapeType && targetLandscapes.has(analysis.landscapeType)) {
          score += 30;
        }

        // Water presence
        const targetHasWater = targetAnalyses.some(a => a.waterDetected);
        if (analysis.waterDetected === targetHasWater) {
          score += 20;
        }

        propertyScores.set(propId, score);
      }

      // Sort by score and return top N
      return Array.from(propertyScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([propId]) => propId);
    } catch (error) {
      console.error('Failed to find similar properties:', error);
      return [];
    }
  }

  /**
   * Batch analyze all unanalyzed photos
   */
  async batchAnalyzePhotos(
    organizationId: string,
    maxPhotos: number = 50
  ): Promise<{ analyzed: number; failed: number }> {
    try {
      const photos = await db.query.propertyPhotos.findMany({
        where: eq(propertyPhotos.hasAnalysis, false),
        limit: maxPhotos,
      });

      let analyzed = 0;
      let failed = 0;

      for (const photo of photos) {
        try {
          await this.analyzePhoto(organizationId, photo.id, photo.url);
          analyzed++;
          
          // Rate limit: wait 1 second between API calls
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          failed++;
          console.error(`Failed to analyze photo ${photo.id}:`, error);
        }
      }

      return { analyzed, failed };
    } catch (error) {
      console.error('Batch photo analysis failed:', error);
      throw error;
    }
  }

  /**
   * Get analysis summary for property
   */
  async getPropertyAnalysisSummary(propertyId: number): Promise<{
    totalPhotos: number;
    analyzedPhotos: number;
    topFeatures: { feature: string; count: number }[];
    dominantLandscape: string;
    hasWater: boolean;
    hasBuildings: boolean;
    avgVegetationDensity: number;
    marketingReady: number;
  }> {
    try {
      const photos = await db.query.propertyPhotos.findMany({
        where: eq(propertyPhotos.propertyId, propertyId),
      });

      const analyses = await db.query.photoAnalysis.findMany({
        where: eq(photoAnalysis.propertyId, propertyId),
      });

      // Calculate feature frequency
      const featureMap = new Map<string, number>();
      const landscapeMap = new Map<string, number>();
      let hasWater = false;
      let hasBuildings = false;
      let totalVegetation = 0;
      let marketingReady = 0;

      for (const analysis of analyses) {
        // Features
        (analysis.detectedFeatures as string[]).forEach(f => {
          featureMap.set(f, (featureMap.get(f) || 0) + 1);
        });

        // Landscape
        if (analysis.landscapeType) {
          landscapeMap.set(
            analysis.landscapeType,
            (landscapeMap.get(analysis.landscapeType) || 0) + 1
          );
        }

        // Flags
        if (analysis.waterDetected) hasWater = true;
        if (analysis.buildingDetected) hasBuildings = true;

        // Vegetation
        totalVegetation += analysis.vegetationDensity;

        // Marketing
        if (analysis.isUsableForMarketing) marketingReady++;
      }

      const topFeatures = Array.from(featureMap.entries())
        .map(([feature, count]) => ({ feature, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const dominantLandscape = Array.from(landscapeMap.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

      return {
        totalPhotos: photos.length,
        analyzedPhotos: analyses.length,
        topFeatures,
        dominantLandscape,
        hasWater,
        hasBuildings,
        avgVegetationDensity: analyses.length > 0 ? totalVegetation / analyses.length : 0,
        marketingReady,
      };
    } catch (error) {
      console.error('Failed to get property analysis summary:', error);
      throw error;
    }
  }
}

export const visionAI = new VisualIntelligence();
