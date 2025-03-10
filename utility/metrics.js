
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

module.exports = { nSecondAverageMax, RollingAverageType };