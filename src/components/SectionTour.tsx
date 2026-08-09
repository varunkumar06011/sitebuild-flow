import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { driver, type DriveStep, type Driver } from "driver.js";
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
    queryFn: () => getCompletedSections(),
    staleTime: Infinity, // cache for the session — only refetch on markComplete
  });

  const completedSections = data?.data ?? [];

  const markComplete = useCallback(
    async (sectionKey: string) => {
      try {
        await markSectionComplete({ section_key: sectionKey });
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
  autoStartDelay = 800,
}: {
  sectionKey: string;
  steps: TourStep[];
  autoStartDelay?: number;
}) {
  const { completedSections, markComplete } = useOnboarding();
  const [tourActive, setTourActive] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const isCompleted = completedSections.includes(sectionKey);

  const cleanupDriver = useCallback(() => {
    if (driverRef.current) {
      try {
        driverRef.current.destroy();
      } catch {
        // ignore — already destroyed
      }
      driverRef.current = null;
    }
    // Remove any leftover driver.js overlay/popup DOM elements that could block clicks
    document.querySelectorAll(".driver-overlay, .driver-popover, [data-driver-overlay]").forEach((el) => el.remove());
    document.body.classList.remove("driver-active", "driver--simple-layout");
    setTourActive(false);
  }, []);

  const startTour = useCallback(() => {
    if (tourActive) return;
    // Clean up any previous driver instance before starting a new one
    cleanupDriver();
    setTourActive(true);

    // Convert data-tour selectors to CSS selectors (use ref for stable callback)
    const currentSteps = stepsRef.current;
    const driverSteps: DriveStep[] = currentSteps.map((s) => ({
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
        cleanupDriver();
      },
      onDestroyed: () => {
        driverRef.current = null;
        setTourActive(false);
      },
      onDoneClick: () => {
        markComplete(sectionKey);
        cleanupDriver();
        toast.success("Tour complete! You can replay it anytime with the help icon.");
      },
    });

    driverRef.current = driverInstance;
    driverInstance.drive();
  }, [sectionKey, markComplete, tourActive, cleanupDriver]);

  // Auto-start tour on first visit (not completed).
  // Uses stepsRef to avoid re-running when the steps array reference changes
  // (which happens on every render since routes define steps inline).
  // Retries up to 10 times if target elements aren't rendered yet.
  useEffect(() => {
    if (isCompleted || tourActive) return;
    if (stepsRef.current.length === 0) return;

    let attempt = 0;
    const maxAttempts = 10;
    let timer: ReturnType<typeof setTimeout>;

    const tryStart = () => {
      const currentSteps = stepsRef.current;
      if (currentSteps.length === 0) return;

      // Check if at least the first element exists (don't require ALL —
      // some may be inside dialogs or scrollable areas not yet visible)
      const firstSelector = currentSteps[0]?.selector ?? "";
      const firstExists = document.querySelector(firstSelector);
      if (firstExists) {
        startTour();
        return;
      }

      attempt++;
      if (attempt < maxAttempts) {
        timer = setTimeout(tryStart, autoStartDelay);
      } else {
        console.warn(`[SectionTour] Tour "${sectionKey}" did not start: first element "${firstSelector}" not found after ${maxAttempts} attempts`);
      }
    };

    timer = setTimeout(tryStart, autoStartDelay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompleted, tourActive, autoStartDelay]);

  // Cleanup driver on unmount — prevents overlay from blocking all clicks
  useEffect(() => {
    return () => {
      cleanupDriver();
    };
  }, [cleanupDriver]);

  // Escape key safety net — force cleanup if driver overlay gets stuck
  useEffect(() => {
    if (!tourActive) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanupDriver();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [tourActive, cleanupDriver]);

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
