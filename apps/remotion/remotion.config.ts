import { Config } from "@remotion/cli/config";

// Render config tuned for ad creative — H.264 MP4, 1080p source, 30fps,
// concurrency tuned for the Fly worker machine (1 CPU shared on lean tier).
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(1);
