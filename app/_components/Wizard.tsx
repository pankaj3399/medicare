"use client";

import { useEffect } from "react";
import { useWizard } from "@/store/wizard";
import ProgressRail from "./ProgressRail";
import StepZip from "./StepZip";
import StepMedicaid from "./StepMedicaid";
import StepDoctors from "./StepDoctors";
import StepDrugs from "./StepDrugs";
import StepPriorities from "./StepPriorities";
import StepLoading from "./StepLoading";
import StepResults from "./StepResults";
import CompareDrawer from "./CompareDrawer";
import CompareModal from "./CompareModal";
import EnrollModal from "./EnrollModal";

export type Broker = {
  name: string;
  npn: string;
  phone: string;
  tel: string;
  email: string;
};

export default function Wizard({ broker }: { broker: Broker }) {
  const step = useWizard((s) => s.step);
  const loading = useWizard((s) => s.loading);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [step, loading]);

  return (
    <div className="wiz">
      <ProgressRail />
      {step === 1 && <StepZip />}
      {step === 2 && <StepMedicaid />}
      {step === 3 && <StepDoctors />}
      {step === 4 && <StepDrugs />}
      {step === 5 && <StepPriorities />}
      {loading && <StepLoading />}
      {step === 6 && !loading && <StepResults />}
      <CompareDrawer />
      <CompareModal />
      <EnrollModal broker={broker} />
    </div>
  );
}
