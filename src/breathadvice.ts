import type { Response } from "./engine/hrv";

/**
 * When to breathe, and for how long, from the assessment's response: the
 * row on the assessment (`assessmentcard.tsx`) and the reason on Breathe
 * (`app/breathe.tsx`). How to breathe is on `app/breathing.tsx`.
 *
 * Slow breathing, about six breaths a minute, raises HRV while it lasts and
 * brings heart rate and arousal down for a while after. Practised daily for
 * weeks it lowers stress and anxiety; whether it lifts resting HRV for good
 * is less certain. It does not undo fatigue: rest and sleep do, and slow
 * breathing before bed can help with sleep. So steady days are for practice,
 * an acute stressor for a few minutes before trading, and fatigue for the
 * evening. None of it changes the assessment.
 */

export interface BreathAdvice {
  /** When, in a few words. */
  when: string;
  /** Minutes. */
  min: number;
  /** A second time, if any, in a few words. */
  also: string | null;
  /** Why this, today: for the Breathe screen. */
  why: string;
  /** Whether the day is strained (`app/assessment.tsx`): the row stands out. */
  strained: boolean;
}

const DAILY: BreathAdvice = {
  when: "Every day",
  min: 10,
  also: "after the morning reading",
  why: "Steady days are for practice. Slow breathing done daily, for weeks, lowers stress and anxiety, and makes the pace easy to find on the days you need it.",
  strained: false,
};

export function breathAdvice(r: Response | null): BreathAdvice {
  switch (r) {
    case "acute":
      return {
        when: "Before you trade",
        min: 5,
        also: "and after a loss",
        why: "Acute stress puts the body on alert. Five slow minutes before you trade, and again after a loss before the next trade, bring heart rate and arousal down for a while. They do not change the assessment: follow it either way.",
        strained: true,
      };
    case "fatigue":
      return {
        when: "Tonight, before bed",
        min: 15,
        also: "to help you sleep",
        why: "Accumulated fatigue is put right by rest and sleep, not by breathing. Slow breathing before bed can help you fall asleep and sleep better. It does not change the assessment: follow it either way.",
        strained: true,
      };
    case "maladaptation":
      return {
        when: "Before you trade",
        min: 5,
        also: "and 15 min before bed",
        why: "Your body is strained and not adapting. Five slow minutes before you trade bring arousal down for a while, and fifteen before bed can help you sleep. What brings HRV back is less load and more rest: follow the assessment either way.",
        strained: true,
      };
    case null:
      return { ...DAILY, why: "Practice while your first week of readings builds. Slow breathing done daily, for weeks, lowers stress and anxiety, and makes the pace easy to find on the days you need it." };
    default:
      return DAILY;
  }
}
