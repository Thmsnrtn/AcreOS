import { Button } from "@/components/ui/button";
import { Handshake, Plus, Sparkles, DollarSign, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

interface DealsEmptyStateProps {
  onAddDeal?: () => void;
}

export function DealsEmptyState({ onAddDeal }: DealsEmptyStateProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-16 px-4"
      data-testid="empty-state-deals"
    >
      <div className="relative mb-6">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center"
        >
          <Handshake className="w-12 h-12 text-amber-600" />
        </motion.div>
        
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="absolute -top-1 -right-3 w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center"
        >
          <DollarSign className="w-5 h-5 text-green-600" />
        </motion.div>
        
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="absolute -bottom-2 -left-2 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"
        >
          <TrendingUp className="w-4 h-4 text-primary" />
        </motion.div>
      </div>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-md"
      >
        <h3 className="text-xl font-semibold mb-2">
          Ready to close your first deal?
        </h3>
        <p className="text-muted-foreground mb-6">
          Track your acquisitions and dispositions from offer to close. 
          See your profit margins, timelines, and success rate at a glance.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {onAddDeal && (
            <Button onClick={onAddDeal} data-testid="button-add-deal">
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Deal
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
            <Sparkles className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium mb-1">Pro tip</p>
              <p className="text-sm text-muted-foreground">
                Link deals to properties and leads to get a complete picture of 
                your land investing pipeline from lead to profit.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
