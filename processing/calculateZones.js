/**
 * Calculate time spent in each heart rate zone.
 * @param {number[]} zoneData - Array of heart rate, power, or similar measurements (one per second).
 * @param {string} zoneString - Comma-separated string representing zone thresholds.
 * @returns {number[]} - Array of integers representing time (in seconds) spent in each zone.
 */
function calculateZones(zoneData, zones) {
  if (!Array.isArray(zoneData) || zoneData.length === 0) {
    console.log("Zone data must be a non-empty array of numbers.");
    return [];
  }

  if (zones.every(value => !isNaN(value))) {
      // All values are numbers
  } else {
    console.log("All values must be numbers.");
    return [];
  }
  if(zones.length < 2) {
    console.log("At least two zone thresholds are required.");
    return [];
  }

  // Initialize an array to track time spent in each zone
  const timeInZones = new Array(zones.length).fill(0);

  // Iterate through the heart rate data
  zoneData.forEach(zoneDatum => {
    for (let i = 0; i < zones.length; i++) {
        if (i === 0 && zoneDatum <= zones[i]) {
            // Zone 1: less than or equal to first threshold
            timeInZones[i]++;
            break;
        } else if (i === zones.length - 1 && zoneDatum > zones[i - 1]) {
            // Zone 5: greater than last threshold
            timeInZones[i]++;
            break;
        } else if (zoneDatum > zones[i - 1] && zoneDatum <= zones[i]) {
            // Other zones: between previous and current thresholds
            timeInZones[i]++;
            break;
        }
    }
  });

  return timeInZones;
}

module.exports = {
  calculateZones,
};
