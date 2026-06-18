import { useDashboardStore } from "./store";
import * as mock from "./mockData";

export function useChartData() {
  const { dataMode, liveData } = useDashboardStore();

  if (dataMode === "sample" || !liveData) {
    return {
      hrv: mock.mockHRV,
      ansBalance: mock.mockANSBalance,
      spo2Nocturnal: mock.mockSpO2Nocturnal,
      skinTemp: mock.mockSkinTemp,
      sleepDebt: mock.mockSleepDebt,
      vo2Max: mock.mockVO2Max,
      acuteStress: mock.mockAcuteStress,
    };
  }

  // --- Map Live Data from FastAPI Gateway ---
  // 1. HRV: Live data uses DAILY_HEART_RATE_VARIABILITY rollups or raw hrv
  // Fallback to daily_hrv or calculate from hrv series if present.
  const rawHrv = liveData.hrv || [];
  const hrvMapped = rawHrv.map((d: any) => ({
    date: d.timestamp.split("T")[0],
    value: typeof d.value === "number" ? d.value : parseFloat(d.value),
  })).sort((a: any, b: any) => a.date.localeCompare(b.date));

  // 2. ANS Balance: Already computed on backend
  const ansMapped = (liveData.derived?.ans_balance || []).map((d: any) => ({
    date: d.date,
    lf_power: d.lf_power,
    hf_power: d.hf_power,
    lf_hf_ratio: d.lf_hf_ratio,
  })).sort((a: any, b: any) => a.date.localeCompare(b.date));

  // 3. Skin Temp (DAILY_SLEEP_TEMPERATURE_DERIVATIONS)
  const tempMapped = (liveData.sleep_temp || []).map((d: any) => ({
    date: d.timestamp.split("T")[0],
    value: typeof d.value === "number" ? d.value : parseFloat(d.value),
  })).sort((a: any, b: any) => a.date.localeCompare(b.date));

  // 4. Sleep Debt: Already computed on backend
  const sleepDebtMapped = (liveData.derived?.sleep_debt || []).map((d: any) => ({
    date: d.date,
    actual_hours: d.actual_hours,
    target_hours: d.target_hours,
    debt_hours: d.debt_hours,
  })).sort((a: any, b: any) => a.date.localeCompare(b.date));

  // 5. VO2 Max: Prefer native Google/Fitbit daily VO2, fallback to derived estimate.
  const vo2Source = (liveData.daily_vo2_max || []).length
    ? liveData.daily_vo2_max
    : (liveData.derived?.vo2_max || []);
  const vo2MaxMapped = vo2Source.map((d: any) => ({
    date: d.date,
    vo2_max: d.vo2_max,
    level: d.level,
  })).sort((a: any, b: any) => a.date.localeCompare(b.date));

  // 6. Acute Stress Events: Already computed on backend
  const stressMapped = (liveData.derived?.acute_stress || []).map((d: any, idx: number) => ({
    id: `live-stress-${idx}`,
    start: d.start,
    end: d.end,
    hr_peak: d.hr_peak,
    severity: d.severity,
    date: d.start.split("T")[0],
  }));

  // 7. Nocturnal SpO2 (Group 5-minute resolution oxygen saturation values by date)
  // Live data returns raw OXYGEN_SATURATION measurements during sleep/nocturnal hours.
  const rawSpo2 = liveData.spo2 || [];
  const spo2Grouped: Record<string, mock.SpO2Reading[]> = {};

  rawSpo2.forEach((d: any) => {
    const dateStr = d.timestamp.split("T")[0];
    const timeStr = d.timestamp.substring(11, 16); // Extract HH:MM
    if (!spo2Grouped[dateStr]) {
      spo2Grouped[dateStr] = [];
    }
    spo2Grouped[dateStr].push({
      time: timeStr,
      value: typeof d.value === "number" ? d.value : parseFloat(d.value),
    });
  });

  // Ensure each night's readings are chronologically sorted
  Object.keys(spo2Grouped).forEach((dateKey) => {
    spo2Grouped[dateKey].sort((a, b) => a.time.localeCompare(b.time));
  });

  return {
    hrv: hrvMapped,
    ansBalance: ansMapped,
    spo2Nocturnal: spo2Grouped,
    skinTemp: tempMapped,
    sleepDebt: sleepDebtMapped,
    vo2Max: vo2MaxMapped,
    acuteStress: stressMapped,
  };
}
export type ChartData = ReturnType<typeof useChartData>;
