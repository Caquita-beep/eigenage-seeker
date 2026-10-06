/**
 * WHOOP's v2 API, as its published OpenAPI document declares it
 * (https://api.prod.whoop.com/developer/doc/openapi.json, read 1 Oct 2026).
 *
 * Only the three collections Exposure reads, and only as WHOOP names them —
 * no field renamed, none added — so the synthetic member in `synthetic.ts` and
 * the real API are interchangeable behind `collect()`. A field marked optional
 * here is one the document leaves out of `required`; `score` is absent unless
 * `score_state` is `SCORED`.
 */

export type ScoreState = "SCORED" | "PENDING_SCORE" | "UNSCORABLE";

export interface Page<T> {
  records: T[];
  /** Absent or empty on the last page. */
  next_token?: string | null;
}

export interface Recovery {
  cycle_id: number;
  /** The sleep this recovery was measured from. */
  sleep_id: string;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: ScoreState;
  score?: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    /** 4.0 members only. */
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

export interface Sleep {
  id: string;
  cycle_id: number;
  v1_id?: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  /** "-05:00" — the member's offset when this sleep was recorded. */
  timezone_offset: string;
  nap: boolean;
  score_state: ScoreState;
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
}

export interface Cycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  /** Absent on the member's current cycle, which is still accumulating. */
  end?: string | null;
  timezone_offset: string;
  score_state: ScoreState;
  score?: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
  step_count?: number;
}

/** A member's history over a window, as three collections. */
export interface Member {
  recoveries: Recovery[];
  sleeps: Sleep[];
  cycles: Cycle[];
}
