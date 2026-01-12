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
      <div className="relative mb-6">
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
          className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center"
        >
          <Target className="w-5 h-5 text-green-500" />
        </motion.div>
        
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="absolute -bottom-1 -left-3 w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center"
        >
          <TrendingUp className="w-4 h-4 text-amber-500" />
        </motion.div>
      </div>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-md"
      >
        <h3 className="text-xl font-semibold mb-2">
          Your lead pipeline starts here
        </h3>
        <p className="text-muted-foreground mb-6">
          Import your first batch of leads or add them one by one. AcreOS will help you track 
          every conversation and close more deals.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {onAddLead && (
            <Button onClick={onAddLead} data-testid="button-add-lead">
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Lead
            </Button>
          )}
          {onImportLeads && (
            <Button variant="outline" onClick={onImportLeads} data-testid="button-import-leads">
              <Upload className="w-4 h-4 mr-2" />
              Import from CSV
            </Button>
          )}
        </div>
        
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
                AcreOS can score your leads automatically based on motivation signals, 
                helping you focus on the sellers most likely to close.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
