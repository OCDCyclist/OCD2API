function convertCelsiusToFahrenheit(celsius) {
  return (celsius * 9/5) + 32;
}

function convertMetersPerSecondToMilesPerHour(metersPerSecond) {
  const metersPerSecondToMph = 2.23694; // Conversion factor
  return metersPerSecond * metersPerSecondToMph;
}

function convertMetersToFeet(meters) {
  const metersToFeet = 3.28084; // Conversion factor
  return meters * metersToFeet;
}

const RollingAverageType = Object.freeze({
  MAX: "max",
  MIN: "min",
});

const nSecondAverageMax = (data, period, decimalPlaces, type, conversionFactor = 1) => {
  if (!Object.values(RollingAverageType).includes(type)) {
    console.log(`Invalid rolling average type: ${type}`);
    type = RollingAverageType.MAX;
  }

  // Handle invalid cases
  if (period < 0 || (period > 0 && data.length < period)){
    return { metric_value: 0, startIndex: -1, period: period };
  }

  let metric_value = type === RollingAverageType.MAX ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  let startIndex = -1;

  // When period is 0, calculate the average of the entire array
  if (period === 0) {
    if (data.length === 0) return { metric_value: 0, startIndex: -1, period: 0 };
    const totalSum = data.reduce((acc, val) => acc + val, 0);
    metric_value = totalSum / data.length;
    startIndex = 0;
  } else {
    // Find the maximum average for the given period
    for (let i = 0; i <= data.length - period; i++) {
      const sum = data.slice(i, i + period).reduce((acc, val) => acc + val, 0);
      const avg = sum / period;
      if (type === RollingAverageType.MAX) {
        if (avg > metric_value) {
          metric_value = avg;
          startIndex = i;
        }
      }
      else{
        if (avg < metric_value) {
          metric_value = avg;
          startIndex = i;
        }
      }
    }
  }

  // Round to the specified number of decimal places
  const factor = Math.pow(10, decimalPlaces);
  metric_value = Math.round(conversionFactor * metric_value * factor) / factor;

  return { metric_value, startIndex, period };
};

function calculateNormalizedPower(powerData) {
    if (!Array.isArray(powerData) || powerData.length === 0) {
      return { metric_value: 0, startIndex: -1, period: 0 };
    }

    const maxPeriod = powerData.length;

    const rollingNormalizedWindow = 30; // 30-second rolling average for normalized power.
    if( maxPeriod < rollingNormalizedWindow){
      return { metric_value: 0, startIndex: 0, period: 0 };
    }

    const rollingNormalizedAverages = [];
    for (let i = 0; i < powerData.length; i++) {
        const startNormalized = Math.max(0, i - rollingNormalizedWindow + 1);
        const windowSliceNormalized = powerData.slice(startNormalized, i + 1);
        const rollingNormalicedAvg = windowSliceNormalized.reduce((sum, val) => sum + val, 0) / windowSliceNormalized.length;
        rollingNormalizedAverages.push(rollingNormalicedAvg);
    }

    // Calculate Normalized Power
    // Raise each rolling average to the fourth power
    const fourthPowers = rollingNormalizedAverages.map(avg => Math.pow(avg, 4));
    const meanFourthPower = fourthPowers.reduce((sum, val) => sum + val, 0) / fourthPowers.length;
    const normalizedPower = Math.pow(meanFourthPower, 0.25);
    return { metric_value: Math.round(normalizedPower), startIndex: 0, period: 0 };
}

function createMetricObject(metric, value) {
  return { metric, ...value };
}

function calculatePowerMetrics(powerData) {
  if (!Array.isArray(powerData) || powerData.length === 0) {
    console.log("Power data must be a non-empty array of numbers.");
    return [];
  }

  const metric = "watts";
  const metrics = [];

  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 0, 0, RollingAverageType.MAX) ));  // "0" is a special case for overall average
  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 1, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 3, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 30, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 60, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 300, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 600, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(powerData, 1200, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("normalized", calculateNormalizedPower(powerData) ));

  return metrics;
}

function calculateCadenceMetrics(cadenceData) {
  const MIN_CADENCE = 40;
  if (!Array.isArray(cadenceData) || cadenceData.length === 0) {
    console.log("Cadence data must be a non-empty array of numbers.");
    return [];
  }

  const metric = "cadence";
  const metrics = [];

  // Calculate overall average cadence only considering cadences above MIN_CADENCE
  const minimumCadenceData = cadenceData.filter(cadence => cadence >= MIN_CADENCE);

  // Calculate peak averages for different intervals
  metrics.push(createMetricObject(metric, nSecondAverageMax(minimumCadenceData, 0, 0, RollingAverageType.MAX) ));  // "0" is a special case for overall average
  metrics.push(createMetricObject(metric, nSecondAverageMax(cadenceData, 10, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(cadenceData, 30, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(cadenceData, 60, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(cadenceData, 300, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(cadenceData, 600, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(cadenceData, 1200, 0, RollingAverageType.MAX) ));
  return metrics;
}

function calculateHeartRateMetrics(hrData) {
  if (!Array.isArray(hrData) || hrData.length === 0) {
    console.log("HR data must be a non-empty array of numbers.");
    return [];
  }

  const metric = "heartrate";
  const metrics = [];

  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 0, 0, RollingAverageType.MAX) )); // "0" is a special case for overall average
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 1, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 5, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 10, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 20, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 30, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 60, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 300, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 600, 0, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(hrData, 1200, 0, RollingAverageType.MAX) ));

  return metrics;
}

function calculateHeartRateRecoveryMetrics(
  hrData,
  powerData,
  config = {
    minPeakPower: 500,             // sprint threshold
    minEffortDurationSec: 3,       // must be sustained
    minPeakHR: 150,                // HR must exceed this
    stopPedalingThreshold: 20,     // watts
    maxHRRWindowSec: 180,          // seconds of HR data after peak to analyze
    samplingRateHz: 1              // 1 sample per second by default
  }
) {
  const results = [];
  const {
    minPeakPower,
    minEffortDurationSec,
    minPeakHR,
    stopPedalingThreshold,
    maxHRRWindowSec,
    samplingRateHz
  } = config;

  const samplesPerSecond = samplingRateHz;

  // ---------------------------
  // 1. Find high-intensity efforts
  // ---------------------------
  let i = 0;
  while (i < powerData.length) {
    if (powerData[i] >= minPeakPower) {
      let start = i;

      // sustain for required duration
      while (i < powerData.length && powerData[i] >= minPeakPower) {
        i++;
      }
      let end = i - 1;

      const effortDurationSec = (end - start + 1) / samplesPerSecond;
      if (effortDurationSec < minEffortDurationSec) continue;

      // ---------------------------
      // 2. Identify peak power within effort
      // ---------------------------
      let peakPower = -Infinity;
      let idxPeakPower = start;
      for (let j = start; j <= end; j++) {
        if (powerData[j] > peakPower) {
          peakPower = powerData[j];
          idxPeakPower = j;
        }
      }

      // ---------------------------
      // 3. Find HR peak near the power peak (± 20 sec window)
      // ---------------------------
      const window = 20 * samplesPerSecond;
      let hrWindowStart = Math.max(0, idxPeakPower - window);
      let hrWindowEnd = Math.min(hrData.length - 1, idxPeakPower + window);

      let hrPeak = -Infinity;
      let idxHRPeak = hrWindowStart;
      for (let j = hrWindowStart; j <= hrWindowEnd; j++) {
        if (hrData[j] > hrPeak) {
          hrPeak = hrData[j];
          idxHRPeak = j;
        }
      }

      if (hrPeak < minPeakHR) continue; // filtering weak efforts

      // ---------------------------
      // 4. Identify stop-pedaling point after peak power
      // ---------------------------
      let idxStopPedaling = idxPeakPower;
      while (
        idxStopPedaling < powerData.length &&
        powerData[idxStopPedaling] > stopPedalingThreshold
      ) {
        idxStopPedaling++;
      }

      // ---------------------------
      // 5. Compute HRR60, HRR120
      // ---------------------------
      const idxHRR60 = idxHRPeak + 60 * samplesPerSecond;
      const idxHRR120 = idxHRPeak + 120 * samplesPerSecond;

      const hrAt60 = idxHRR60 < hrData.length ? hrData[idxHRR60] : null;
      const hrAt120 = idxHRR120 < hrData.length ? hrData[idxHRR120] : null;

      const HRR60 = hrAt60 !== null ? hrPeak - hrAt60 : 0;
      const HRR120 = hrAt120 !== null ? hrPeak - hrAt120 : 0;

      // ---------------------------
      // 6. Fit exponential decay to compute HRRτ
      // ---------------------------
      let recoveryPoints = [];
      const maxWindowSamples = maxHRRWindowSec * samplesPerSecond;

      for (
        let j = idxHRPeak;
        j < Math.min(hrData.length, idxHRPeak + maxWindowSamples);
        j++
      ) {
        const t = (j - idxHRPeak) / samplesPerSecond;
        const hr = hrData[j];
        if (hr < hrPeak) {
          recoveryPoints.push({ t, hr });
        }
      }

      let tau = null;
      if (recoveryPoints.length > 3) {
        // Fit ln((HR - HR_rest) / (HR_peak - HR_rest))
        // Estimate HR_rest as mean of last few seconds
        const tailCount = Math.min(10, recoveryPoints.length);
        const HR_rest =
          recoveryPoints
            .slice(-tailCount)
            .reduce((sum, p) => sum + p.hr, 0) / tailCount;

        const filtered = recoveryPoints.filter(p => p.hr > HR_rest);
        const xs = filtered.map(p => p.t);
        const ys = filtered.map(
          p => Math.log((p.hr - HR_rest) / (hrPeak - HR_rest))
        );

        // linear regression y = a + b x
        let sumX = 0,
          sumY = 0,
          sumXY = 0,
          sumXX = 0;
        for (let k = 0; k < xs.length; k++) {
          sumX += xs[k];
          sumY += ys[k];
          sumXY += xs[k] * ys[k];
          sumXX += xs[k] * xs[k];
        }
        const n = xs.length;
        const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

        tau = -1 / b; // time constant
      }

      // ---------------------------
      // 7. Push results
      // ---------------------------
      results.push({
        start,
        end,
        idxPeakPower,
        idxHRPeak,
        idxStopPedaling,
        peakPower,
        hrPeak,
        HRR60,
        HRR120,
        tau
      });
    } else {
      i++;
    }
  }

  return results;
}

function calculateTemperatureMetrics(tempData) {
  if (!Array.isArray(tempData) || tempData.length === 0) {
    console.log("Temperature data must be a non-empty array of numbers.");
    return [];
  }

  const tempDataF = tempData.map(temp => convertCelsiusToFahrenheit(temp));
  const metrics = [];

  metrics.push(createMetricObject("tempAvg", nSecondAverageMax(tempDataF, 0, 1, RollingAverageType.MAX, ) )); // "0" is a special case for overall average

  metrics.push(createMetricObject("tempMax", nSecondAverageMax(tempDataF, 60, 1, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("tempMax", nSecondAverageMax(tempDataF, 300, 1, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("tempMax", nSecondAverageMax(tempDataF, 600, 1, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("tempMax", nSecondAverageMax(tempDataF, 1200, 1, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("tempMax", nSecondAverageMax(tempDataF, 3600, 1, RollingAverageType.MAX) ));

  metrics.push(createMetricObject("tempMin", nSecondAverageMax(tempDataF, 60, 1, RollingAverageType.MIN) ));
  metrics.push(createMetricObject("tempMin", nSecondAverageMax(tempDataF, 300, 1, RollingAverageType.MIN) ));
  metrics.push(createMetricObject("tempMin", nSecondAverageMax(tempDataF, 600, 1, RollingAverageType.MIN) ));
  metrics.push(createMetricObject("tempMin", nSecondAverageMax(tempDataF, 1200, 1, RollingAverageType.MIN) ));
  metrics.push(createMetricObject("tempMin", nSecondAverageMax(tempDataF, 3600, 1, RollingAverageType.MIN) ));

  return metrics;
}

function calculateSpeedMetrics(speedData) {
  if (!Array.isArray(speedData) || speedData.length === 0) {
    console.log("Speed data must be a non-empty array of numbers.");
    return [];
  }

  const speedDataMph = speedData.map(speed => convertMetersPerSecondToMilesPerHour(speed));

  const metric = "velocity_smooth";
  const metrics = [];

  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 0, 2, RollingAverageType.MAX) )); // "0" is a special case for overall average
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 1, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 5, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 10, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 20, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 30, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 60, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 300, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 600, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 1200, 2, RollingAverageType.MAX) ));
  metrics.push(createMetricObject(metric, nSecondAverageMax(speedDataMph, 3600, 2, RollingAverageType.MAX) ));

  return metrics;
}

function calculateAltitudeMetrics(altitudeData) {
  if (!Array.isArray(altitudeData) || altitudeData.length === 0) {
    console.log("Altitude data must be a non-empty array of numbers.");
    return [];
  }

  const altitudeDataFeet = altitudeData.map(altitude => convertMetersToFeet(altitude));

  const metrics = [];
  metrics.push(createMetricObject("altitude", nSecondAverageMax(altitudeDataFeet, 0, 1, RollingAverageType.MAX) )); // "0" is a special case for overall average

  metrics.push(createMetricObject("altitudeHigh", nSecondAverageMax(altitudeDataFeet, 1, 1, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("altitudeHigh", nSecondAverageMax(altitudeDataFeet, 600, 1, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("altitudeHigh", nSecondAverageMax(altitudeDataFeet, 1200, 1, RollingAverageType.MAX) ));
  metrics.push(createMetricObject("altitudeHigh", nSecondAverageMax(altitudeDataFeet, 3600, 1, RollingAverageType.MAX) ));

  metrics.push(createMetricObject("altitudeLow", nSecondAverageMax(altitudeDataFeet, 1, 1, RollingAverageType.MIN) ));
  metrics.push(createMetricObject("altitudeLow", nSecondAverageMax(altitudeDataFeet, 600, 1, RollingAverageType.MIN) ));
  metrics.push(createMetricObject("altitudeLow", nSecondAverageMax(altitudeDataFeet, 1200, 1, RollingAverageType.MIN) ));
  metrics.push(createMetricObject("altitudeLow", nSecondAverageMax(altitudeDataFeet, 3600, 1, RollingAverageType.MIN) ));

  return metrics;
}

module.exports = {
  calculateCadenceMetrics,
  calculatePowerMetrics,
  calculateHeartRateMetrics,
  calculateHeartRateRecoveryMetrics,
  calculateTemperatureMetrics,
  calculateSpeedMetrics,
  calculateAltitudeMetrics,
  nSecondAverageMax,
  RollingAverageType
};
