import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ISISImpactAnalyzer from "@/components/ImpactAnalyzer/index";

const IsisImpactAnalyzer = () => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] w-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/dashboard")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>
        <span className="text-sm text-muted-foreground">ISIS Impact Analyzer</span>
      </div>
      <ISISImpactAnalyzer/>
    </div>
  );
};

export default IsisImpactAnalyzer;
