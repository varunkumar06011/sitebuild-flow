import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { getCompletedSections, markSectionComplete } from "@/lib/api/onboarding";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Context — caches completed sections at the AppShell level so we don't fire
// a query per route. Each route's SectionTour reads from this cache.
// ---------------------------------------------------------------------------
type OnboardingCtx = {
  completedSections: string[];
  refetchCompleted: () => void;
  markComplete: (sectionKey: string) => Promise<void>;
};

const Ctx = createContext<OnboardingCtx>({
  completedSections: [],
  refetchCompleted: () => {},
  markComplete: async () => {},
});

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, refetch } = useQuery({
    queryKey: ["onboardingCompleted"],
    queryFn: () => getCompletedSections({ data: {} }),
    staleTime: Infinity, // cache for the session — only refetch on markComplete
  });

  const completedSections = data?.data ?? [];

  const markComplete = useCallback(
    async (sectionKey: string) => {
      try {
        await markSectionComplete({ data: { section_key: sectionKey } });
        queryClient.setQueryData(["onboardingCompleted"], (old: any) => ({
          ...old,
          data: [...(old?.data ?? []), sectionKey],
        }));
      } catch {
        // silent — tour completion is non-critical
      }
    },
    [queryClient],
  );

  return (
    <Ctx.Provider value={{ completedSections, refetchCompleted: refetch, markComplete }}>
      {children}
    </Ctx.Provider>
  );
}

export const useOnboarding = () => useContext(Ctx);

// ---------------------------------------------------------------------------
// Tour step type
// ---------------------------------------------------------------------------
export type TourStep = {
  selector: string;
  title: string;
  description: string;
};

// ---------------------------------------------------------------------------
// SectionTour — reusable wrapper that auto-starts a driver.js tour if the
// section hasn't been completed yet. Also renders a "Replay tour" button.
// ---------------------------------------------------------------------------
export function SectionTour({
  sectionKey,
  steps,
  autoStartDelay = 500,
}: {
  sectionKey: string;
  steps: TourStep[];
  autoStartDelay?: number;
}) {
  const { completedSections, markComplete } = useOnboarding();
  const [tourActive, setTourActive] = useState(false);

  const isCompleted = completedSections.includes(sectionKey);

  const startTour = useCallback(() => {
    if (tourActive) return;
    setTourActive(true);

    // Convert data-tour selectors to CSS selectors
    const driverSteps: DriveStep[] = steps.map((s) => ({
      element: s.selector,
      popover: {
        title: s.title,
        description: s.description,
      },
    }));

    const driverInstance = driver({
      steps: driverSteps,
      showProgress: true,
      allowClose: true,
      overlayClickBehavior: "close",
      doneBtnText: "Got it",
      nextBtnText: "Next →",
      prevBtnText: "← Back",
      progressText: "{{current}} of {{total}}",
      onCloseClick: () => {
        markComplete(sectionKey);
        driverInstance.destroy();
        setTourActive(false);
      },
      onDestroyed: () => {
        setTourActive(false);
      },
      onDoneClick: () => {
        markComplete(sectionKey);
        driverInstance.destroy();
        setTourActive(false);
        toast.success("Tour complete! You can replay it anytime with the help icon.");
      },
    });

    driverInstance.drive();
  }, [sectionKey, steps, markComplete, tourActive]);

  // Auto-start tour on first visit (not completed)
  useEffect(() => {
    if (!isCompleted && !tourActive && steps.length > 0) {
      const timer = setTimeout(() => {
        // Verify all target elements exist before starting
        const allExist = steps.every((s) => document.querySelector(s.selector));
        if (allExist) {
          startTour();
        }
      }, autoStartDelay);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isCompleted, tourActive, steps, startTour, autoStartDelay]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0"
      onClick={startTour}
      disabled={tourActive}
      aria-label="Replay tour"
      title="Replay tour"
    >
      <HelpCircle className="size-4 text-muted-foreground" />
    </Button>
  );
}
