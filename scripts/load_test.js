import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp-up to 50 users
    { duration: '1m', target: 50 },   // Sustain 50 users
    { duration: '30s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% of requests must complete below 1.0s
    http_req_failed: ['rate<0.01'],    // Error rate must be less than 1%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:8000';
const SESSION_ID = `perf-test-${Math.floor(Math.random() * 1000000)}`;

export default function () {
  const payload = JSON.stringify({
    user_text: 'Hello, testing system load with high concurrent requests.',
    session_id: SESSION_ID,
    user_id: 'load_test_user',
    user_initiated: true,
    audio_rms: 0.1,
    pause_ms: 1000
  });

  const headers = { 'Content-Type': 'application/json' };
  
  // Test the /api/analyze endpoint (which hits the shared L1-L5 pipeline)
  const res = http.post(`${BASE_URL}/api/analyze`, payload, { headers });
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has behavior instructions': (r) => r.json('behavior_instructions') !== undefined,
  });

  sleep(1);
}
