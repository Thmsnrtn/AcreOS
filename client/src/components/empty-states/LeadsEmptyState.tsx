import { Button } from "@/components/ui/button";
import { Users, Plus, Upload, Sparkles, Target, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

interface LeadsEmptyStateProps {
  onAddLead?: () => void;
  onImportLeads?: () => void;
}

export function LeadsEmptyState({ onAddLead, onImportLeads }: LeadsEmptyStateProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-16 px-4"
      data-testid="empty-state-leads"
    >
      <div className="relative mb-6" aria-hidden="true">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"
        >
          <Users className="w-12 h-12 text-primary" />
        </motion.div>

        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-acr-pos/10 flex items-center justify-center"
        >
          <Target className="w-5 h-5 text-acr-pos" />
        </motion.div>

        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="absolute -bottom-1 -left-3 w-8 h-8 rounded-full bg-acr-warn/10 flex items-center justify-center"
        >
          <TrendingUp className="w-4 h-4 text-acr-warn" />
        </motion.div>
      </div>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-md"
      >
        <h3 className="text-xl font-semibold mb-2">
          Tell Pax which counties to watch
        </h3>
        <p className="text-muted-foreground mb-6">
          You haven't told Pax which counties to watch yet. Paste a county
          list or upload a CSV — Pax scores every new record within 90
          seconds and surfaces the top three on Today by 6am.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {onAddLead && (
            <Button type="button" onClick={onAddLead} data-testid="button-add-lead-empty">
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              Add your first lead
            </Button>
          )}
          {onImportLeads && (
            <Button type="button" variant="outline" onClick={onImportLeads} data-testid="button-import-leads">
              <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
              Import from CSV
            </Button>
          )}
        </div>

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
                Pax scores every new lead within 90 seconds against the
                motivation signals it tracks — tax delinquency, vacancy,
                inherited deed — so the top three are on Today by 6am.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
