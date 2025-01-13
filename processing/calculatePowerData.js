function convertCelsiusToFahrenheit(celsius) {
  return (celsius * 9/5) + 32;
}

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
  calculateTemperatureMetrics,
  calculateSpeedMetrics,
  calculateAltitudeMetrics,
};
