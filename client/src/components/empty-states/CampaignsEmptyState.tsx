import { Button } from "@/components/ui/button";
import { Mail, Plus, Sparkles, Target } from "lucide-react";
import { motion } from "framer-motion";

interface CampaignsEmptyStateProps {
  onCreateCampaign?: () => void;
}

export function CampaignsEmptyState({ onCreateCampaign }: CampaignsEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-16 px-4"
      data-testid="empty-state-campaigns"
    >
      <div className="relative mb-6" aria-hidden="true">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"
        >
          <Mail className="w-12 h-12 text-primary" />
        </motion.div>
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-acr-warn/10 flex items-center justify-center"
        >
          <Target className="w-5 h-5 text-acr-warn" />
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-md"
      >
        <h3 className="text-xl font-semibold mb-2">Reach motivated sellers</h3>
        <p className="text-muted-foreground mb-6">
          Pick a list and a letter — Pax handles addresses, mail merge,
          and tracking, and threads every reply back against the right
          lead.
        </p>

        {onCreateCampaign && (
          <Button type="button" onClick={onCreateCampaign} data-testid="button-create-campaign-empty">
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            Create your first campaign
          </Button>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 p-4 rounded-card bg-muted/50 text-left"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium mb-1">Pro tip</p>
              <p className="text-sm text-muted-foreground">
                Pax drafts a personalized outreach sequence for each
                lead based on the parcel profile — you approve the
                copy, Pax handles the cadence.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
