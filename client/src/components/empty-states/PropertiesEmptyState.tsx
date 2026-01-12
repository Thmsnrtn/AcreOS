import { Button } from "@/components/ui/button";
import { Map, Plus, Upload, Sparkles, TreePine, Mountain } from "lucide-react";
import { motion } from "framer-motion";

interface PropertiesEmptyStateProps {
  onAddProperty?: () => void;
  onImportProperties?: () => void;
}

export function PropertiesEmptyState({ onAddProperty, onImportProperties }: PropertiesEmptyStateProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-16 px-4"
      data-testid="empty-state-properties"
    >
      <div className="relative mb-6">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          className="w-24 h-24 rounded-full bg-gradient-to-br from-green-500/20 to-green-500/5 flex items-center justify-center"
        >
          <Map className="w-12 h-12 text-green-600" />
        </motion.div>
        
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="absolute -top-1 -right-3 w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center"
        >
          <TreePine className="w-5 h-5 text-emerald-600" />
        </motion.div>
        
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="absolute -bottom-2 -left-2 w-8 h-8 rounded-full bg-sky-500/10 flex items-center justify-center"
        >
          <Mountain className="w-4 h-4 text-sky-600" />
        </motion.div>
      </div>
      
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-md"
      >
        <h3 className="text-xl font-semibold mb-2">
          Your property portfolio starts here
        </h3>
        <p className="text-muted-foreground mb-6">
          Track every parcel from prospect to profit. Add your first property and 
          watch your land investing business grow.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {onAddProperty && (
            <Button onClick={onAddProperty} data-testid="button-add-property">
              <Plus className="w-4 h-4 mr-2" />
              Add First Property
            </Button>
          )}
          {onImportProperties && (
            <Button variant="outline" onClick={onImportProperties} data-testid="button-import-properties">
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
            <Sparkles className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium mb-1">Pro tip</p>
              <p className="text-sm text-muted-foreground">
                Enter the APN (Assessor Parcel Number) to automatically pull county 
                records, GIS data, and comparable sales.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
