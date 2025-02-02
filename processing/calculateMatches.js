const {roundValue} = require('../utility/numerical');

/**
 * Finds matches in power data based on match definitions.
 *
 * @param {Array} powerData - Array of power values (in watts).
 * @param {Array} heartRateData - Array of heart rate values (in bpm).
 * @param {Object} matchDefinition - Match definition containing type, period, and targetftp.
 * @param {number} riderFTP - Functional Threshold Power value.
 * @returns {Array} Array of detected matches.
 */
function calculateMatches(powerData, heartRateData, matchDefinition, riderFTP) {
  const matches = [];

  if (!Array.isArray(powerData) || powerData.length === 0) {
    return [];
  }

  const useHeartRate = (!Array.isArray(heartRateData)) || heartRateData.length !== powerData.length ? false : true;

  const { type, period, targetftp } = matchDefinition;
  if(period <= 0 || targetftp <= 0) return matches;

  const matchFTP =  roundValue((targetftp * riderFTP)/100, 2);

  let i = 0;
  while (i <= powerData.length - period) {
    // Check if the initial period meets the target FTP requirement
    const initialSegment = powerData.slice(i, i + period);
    const initialAveragePower = initialSegment.reduce((sum, p) => sum + p, 0) / period;

    if (initialAveragePower < matchFTP) {
      i++;
      continue;
    }

    // Extend match if power stays above 98% of target FTP
    let matchEnd = i + period;
    while (matchEnd < powerData.length && powerData[matchEnd] >= 0.98 * targetftp) {
      matchEnd++;
    }

    // Extract match data
    const matchSegment = powerData.slice(i, matchEnd);
    const matchHeartRateSegment = heartRateData.slice(i, matchEnd);

    const matchMaxAveragePower = Math.max(
      ...Array.from({ length: matchSegment.length - period + 1 }, (_, idx) => {
        const segment = matchSegment.slice(idx, idx + period);
        return segment.reduce((sum, p) => sum + p, 0) / period;
      })
    );

    const matchAveragePower = matchSegment.reduce((sum, p) => sum + p, 0) / matchSegment.length;
    const matchPeakPower = Math.max(...matchSegment);
    const matchAverageHeartRate = useHeartRate ? matchHeartRateSegment.reduce((sum, hr) => sum + hr, 0) / matchHeartRateSegment.length : 0;

    matches.push({
      type,
      period,
      targetFTP: targetftp,
      startIndex: i,
      actualperiod: matchSegment.length,
      maxaveragepower: roundValue(matchMaxAveragePower,0),
      averagepower: roundValue(matchAveragePower,0),
      peakpower: roundValue(matchPeakPower,0),
      averageheartrate: roundValue(matchAverageHeartRate,0),
    });

    i = matchEnd;
  }

  return matches;
}

module.exports = {
  calculateMatches,
};
