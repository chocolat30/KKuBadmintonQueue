// helpers/queueEstimation.js
const db = require("../db");

const DEFAULT_MATCH_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds

/**
 * Calculate average match duration for a court
 * - If less than 2 matches: use default (10 min)
 * - If 2+ matches: use average of last 10 match durations
 */
function calculateAverageDuration(court_id, callback) {
  db.all(
    `SELECT timestamp FROM match_history 
     WHERE court_id = ? 
     ORDER BY timestamp DESC 
     LIMIT 11`,
    [court_id],
    (err, matches) => {
      if (err || !matches || matches.length < 2) {
        // Less than 2 matches - use default
        return callback(null, DEFAULT_MATCH_DURATION);
      }

      // Reverse to get chronological order (oldest to newest)
      matches.reverse();

      // Calculate duration between consecutive matches (max 10 durations)
      let totalDuration = 0;
      let validDurations = 0;
      const maxDurations = Math.min(matches.length - 1, 10);
      
      for (let i = 0; i < maxDurations; i++) {
        const duration = matches[i + 1].timestamp - matches[i].timestamp;
        if (duration > 0) {
          totalDuration += duration;
          validDurations++;
        }
      }
      
      // If no valid durations, use default
      if (validDurations === 0) {
        return callback(null, DEFAULT_MATCH_DURATION);
      }
      
      const avgDuration = Math.round(totalDuration / validDurations);
      // No upper limit - use actual calculated average
      callback(null, avgDuration);
    }
  );
}

/**
 * Get queue with estimated start times
 * Calculates when each person in queue will play based on:
 * - Time until current match ends
 * - Average match duration for subsequent matches
 * 
 * Logic:
 * - 1st in queue: waits for current match to end
 * - 2nd in queue: waits for current match + 1st queue's match
 * - 3rd in queue: waits for current match + 1st + 2nd queue's matches
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
            let timeUntilCurrentMatchEnds = 0;

            // If there's a current match, calculate when it ends
            if (currentMatch) {
              const elapsedTime = now - currentMatch.timestamp;
              // Match ends when elapsed time equals average duration
              timeUntilCurrentMatchEnds = Math.max(0, avgDuration - elapsedTime);
            }
            
            // Calculate estimated start times for each queue member
            const queueWithEstimates = queue.map((q, idx) => {
              // idx 0 (1st in queue): waits for current match to end
              // idx 1 (2nd in queue): waits for current match + their own match
              // idx 2 (3rd in queue): waits for current match + 1st person's match + their own match
              const timeUntilStart = timeUntilCurrentMatchEnds + (avgDuration * idx);
              
              return {
                ...q,
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