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
      <div className="relative mb-6">
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
          className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center"
        >
          <Target className="w-5 h-5 text-amber-500" />
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-md"
      >
        <h3 className="text-xl font-semibold mb-2">No campaigns yet</h3>
        <p className="text-muted-foreground mb-6">
          Launch direct mail, SMS, or email campaigns to reach motivated sellers at scale.
        </p>

        {onCreateCampaign && (
          <Button onClick={onCreateCampaign} data-testid="button-create-campaign-empty">
            <Plus className="w-4 h-4 mr-2" />
            Create Your First Campaign
          </Button>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 p-4 rounded-lg bg-muted/50 text-left"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium mb-1">Pro tip</p>
              <p className="text-sm text-muted-foreground">
                AcreOS can auto-generate personalized outreach sequences for each lead based on their property profile.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
