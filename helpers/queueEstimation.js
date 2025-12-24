// helpers/queueEstimation.js
const db = require("../db");

const DEFAULT_MATCH_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds

/**
 * Calculate average match duration for a court
 * - If no matches: use default (10 min)
 * - If 1 match: use default (need more data)
 * - If 2+ matches: use average of last 10
 */
function calculateAverageDuration(court_id, callback) {
  db.all(
    `SELECT timestamp FROM match_history 
     WHERE court_id = ? 
     ORDER BY timestamp ASC 
     LIMIT 11`,
    [court_id],
    (err, matches) => {
      if (err || !matches || matches.length < 2) {
        // Not enough matches - use default
        return callback(null, DEFAULT_MATCH_DURATION);
      }

      // Calculate duration between consecutive matches
      let totalDuration = 0;
      const matchCount = Math.min(matches.length - 1, 10); // Use max 10 durations
      
      for (let i = 0; i < matchCount; i++) {
        // Since sorted ASC, next match is newer, so subtract older from newer
        const duration = matches[i + 1].timestamp - matches[i].timestamp;
        // Ignore if duration is negative or too small (shouldn't happen but safety check)
        if (duration > 0) {
          totalDuration += duration;
        }
      }
      
      // Make sure we have valid data
      if (totalDuration === 0 || matchCount === 0) {
        return callback(null, DEFAULT_MATCH_DURATION);
      }
      
      const avgDuration = Math.round(totalDuration / matchCount);
      // Make sure duration is reasonable (at least 1 minute, at most 1 hour)
      const clampedDuration = Math.max(60 * 1000, Math.min(60 * 60 * 1000, avgDuration));
      
      callback(null, clampedDuration);
    }
  );
}

/**
 * Get queue with estimated start times
 * Calculates when each person in queue will play based on:
 * - Current match start time
 * - Average match duration
 */
function getQueueWithEstimates(court_id, callback) {
  // Get current match start time
  db.get(
    "SELECT timestamp FROM current_match WHERE court_id = ? LIMIT 1",
    [court_id],
    (err, currentMatch) => {
      // Calculate average match duration
      calculateAverageDuration(court_id, (err2, avgDuration) => {
        if (err2) return callback(err2);

        // Get the queue
        db.all(
          "SELECT * FROM queue WHERE court_id = ? ORDER BY position ASC",
          [court_id],
          (err3, queue) => {
            if (err3) return callback(err3);

            const now = Date.now();
            const currentMatchStartTime = currentMatch ? currentMatch.timestamp : now;
            
            // Calculate estimated start times for each queue member
            const queueWithEstimates = queue.map((q, idx) => {
              // First in queue starts when current match ends
              // Second starts after that, etc.
              const estimatedStartTime = currentMatchStartTime + (avgDuration * (idx + 1));
              const timeUntilStart = estimatedStartTime - now;
              
              return {
                ...q,
                estimatedStartTime,
                timeUntilStart,
                estimatedStartMinutes: Math.max(0, Math.round(timeUntilStart / (60 * 1000)))
              };
            });

            callback(null, queueWithEstimates, avgDuration);
          }
        );
      });
    }
  );
}

module.exports = {
  calculateAverageDuration,
  getQueueWithEstimates
};