/**
 * Comprehensive Automated Test Script for The Quad:
 * - Connection Handshake (Request -> Accept)
 * - Automatic Match Creation
 * - Private Messaging Storage & Strict Access Control
 * - Reporting Workflow & Platform Admin Resolution
 * - Block Enforcement across Messaging and Discovery
 * - Unmatch Flow
 */

const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

async function runTests() {
  console.log('=====================================================');
  console.log('  STARTING MATCHING, MESSAGING & MODERATION TEST SUITE');
  console.log('=====================================================\n');

  const timestamp = Date.now();
  const userAData = {
    name: `Alice Campus_${timestamp}`,
    email: `alice_${timestamp}@thequad.edu`,
    password: 'Password123!',
    dateOfBirth: '2000-05-15', // 26 yrs old
    gender: 'female',
    city: 'Austin, TX',
    relationshipIntent: 'dating'
  };

  const userBData = {
    name: `Bob Campus_${timestamp}`,
    email: `bob_${timestamp}@thequad.edu`,
    password: 'Password123!',
    dateOfBirth: '1999-08-20', // 27 yrs old
    gender: 'male',
    city: 'Austin, TX',
    relationshipIntent: 'dating'
  };

  const userCData = {
    name: `Charlie Snoop_${timestamp}`,
    email: `charlie_${timestamp}@thequad.edu`,
    password: 'Password123!',
    dateOfBirth: '2001-01-10', // 25 yrs old
    gender: 'male',
    city: 'Houston, TX',
    relationshipIntent: 'campus_friends'
  };

  try {
    // 1. Register Users
    console.log('[1/8] Registering test users (Alice, Bob, Charlie)...');
    const resA = await axios.post(`${API_BASE}/auth/register`, userAData);
    const tokenA = resA.data.data?.token || resA.data.token;
    const idA = resA.data.data?.user?.id || resA.data.data?.user?._id;

    const resB = await axios.post(`${API_BASE}/auth/register`, userBData);
    const tokenB = resB.data.data?.token || resB.data.token;
    const idB = resB.data.data?.user?.id || resB.data.data?.user?._id;

    const resC = await axios.post(`${API_BASE}/auth/register`, userCData);
    const tokenC = resC.data.data?.token || resC.data.token;
    const idC = resC.data.data?.user?.id || resC.data.data?.user?._id;

    console.log(`✓ Users registered successfully:
      Alice: ${idA}
      Bob:   ${idB}
      Charlie: ${idC}`);

    // 2. Alice sends Connection Request to Bob
    console.log('\n[2/8] Alice sends connection request to Bob...');
    const connReqRes = await axios.post(
      `${API_BASE}/connections/request`,
      { targetUserId: idB, source: 'discovery_feed', campusZone: 'main-plaza' },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const connectionPayload = connReqRes.data.data?.connection || connReqRes.data.connection;
    const connectionId = connectionPayload._id;
    console.log(`✓ Connection request created (ID: ${connectionId}, Status: ${connectionPayload.status})`);

    // 3. Bob accepts the Connection Request -> Triggers Match creation
    console.log('\n[3/8] Bob accepts connection request...');
    const acceptRes = await axios.put(
      `${API_BASE}/connections/${connectionId}/respond`,
      { action: 'accept' },
      { headers: { Authorization: `Bearer ${tokenB}` } }
    );
    const updatedConn = acceptRes.data.data?.connection || acceptRes.data.connection;
    console.log(`✓ Connection responded: ${updatedConn.status}`);

    // Check Matches for Alice
    const matchesA = await axios.get(`${API_BASE}/matches`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    const matchesList = matchesA.data.data?.matches || matchesA.data.matches || [];
    if (!matchesList || matchesList.length === 0) {
      throw new Error('Expected Match to be automatically created on acceptance!');
    }
    const matchObj = matchesList[0];
    console.log(`✓ Match successfully created! Match ID: ${matchObj._id}, Status: ${matchObj.status}`);

    // 4. Messaging between Alice and Bob
    console.log('\n[4/8] Alice sends private message to Bob...');
    const sendMsgRes = await axios.post(
      `${API_BASE}/messages/${connectionId}`,
      { text: 'Hey Bob! Nice to match on The Quad campus!' },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const sentMsg = sendMsgRes.data.data?.message || sendMsgRes.data.sentMessage || sendMsgRes.data.message;
    console.log(`✓ Message sent (ID: ${sentMsg._id}, text: "${sentMsg.text}")`);

    // Bob retrieves conversation messages
    const getMsgsRes = await axios.get(`${API_BASE}/messages/${connectionId}`, {
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    const bobMsgs = getMsgsRes.data.data?.messages || getMsgsRes.data.messages || [];
    console.log(`✓ Bob retrieved ${bobMsgs.length} messages.`);

    // 5. Message Security & Authorization: Charlie tries to access or send to Alice-Bob conversation
    console.log('\n[5/8] Testing message security: Charlie attempts unauthorized access...');
    try {
      await axios.get(`${API_BASE}/messages/${connectionId}`, {
        headers: { Authorization: `Bearer ${tokenC}` }
      });
      throw new Error('Security breach! Charlie was able to read Alice & Bob messages.');
    } catch (err) {
      if (err.response && (err.response.status === 403 || err.response.status === 404)) {
        console.log(`✓ Security verified: Charlie blocked with HTTP ${err.response.status}`);
      } else {
        throw err;
      }
    }

    try {
      await axios.post(
        `${API_BASE}/messages/${connectionId}`,
        { text: 'Intruder message' },
        { headers: { Authorization: `Bearer ${tokenC}` } }
      );
      throw new Error('Security breach! Charlie was able to post to Alice & Bob conversation.');
    } catch (err) {
      if (err.response && (err.response.status === 403 || err.response.status === 404)) {
        console.log(`✓ Security verified: Charlie prevented from posting with HTTP ${err.response.status}`);
      } else {
        throw err;
      }
    }

    // 6. User Reporting & Platform Admin resolution
    console.log('\n[6/8] Alice files a report against Bob for review...');
    const reportRes = await axios.post(
      `${API_BASE}/moderation/report`,
      {
        reportedUserId: idB,
        type: 'message',
        reason: 'inappropriate_content',
        details: 'Simulated report for test verification',
        messageContext: 'Sample message context'
      },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    const reportObj = reportRes.data.data?.report || reportRes.data.report;
    const reportId = reportObj._id;
    console.log(`✓ Report submitted (ID: ${reportId}, Status: ${reportObj.status})`);

    // Admin login
    console.log('Logging in as Platform Admin...');
    const adminLoginRes = await axios.post(`${API_BASE}/auth/login`, {
      email: 'admin@thequad.edu',
      password: 'QuadAdminPass2026!'
    });
    const adminToken = adminLoginRes.data.data?.token || adminLoginRes.data.token;

    // Admin fetches reports
    const adminReportsRes = await axios.get(`${API_BASE}/moderation/admin/reports`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const reportsList = adminReportsRes.data.data?.reports || adminReportsRes.data.reports || [];
    const foundReport = reportsList.find((r) => r._id === reportId);
    if (!foundReport) {
      throw new Error('Admin could not find the submitted report in reports list.');
    }
    console.log(`✓ Admin fetched reports list (found report ${reportId}).`);

    // Admin resolves report
    const resolveRes = await axios.put(
      `${API_BASE}/moderation/admin/reports/${reportId}`,
      { status: 'action_taken', adminNotes: 'Verified during automated test' },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    const resolvedReport = resolveRes.data.data?.report || resolveRes.data.report;
    console.log(`✓ Admin updated report status to: ${resolvedReport.status}`);

    // 7. Blocking Enforcement
    console.log('\n[7/8] Alice blocks Bob...');
    await axios.post(
      `${API_BASE}/moderation/block`,
      { targetUserId: idB, reason: 'Testing block mechanics' },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    console.log('✓ Bob blocked by Alice.');

    // Verify Bob cannot message Alice anymore
    try {
      await axios.post(
        `${API_BASE}/messages/${connectionId}`,
        { text: 'Hey Alice are you there?' },
        { headers: { Authorization: `Bearer ${tokenB}` } }
      );
      throw new Error('Block failed! Bob was still able to message Alice.');
    } catch (err) {
      if (err.response && err.response.status === 403) {
        console.log('✓ Block verified: Bob rejected with 403 when trying to message Alice.');
      } else {
        throw err;
      }
    }

    // Verify Bob does not appear in Alice discovery feed
    const discFeed = await axios.get(`${API_BASE}/discovery/feed`, {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    const feedList = discFeed.data.data?.feed || discFeed.data.feed || [];
    const containsBob = feedList.some((u) => (u._id || u.id) === idB);
    if (containsBob) {
      throw new Error('Block failed! Bob still appeared in Alice discovery feed.');
    }
    console.log('✓ Discovery isolation verified: Bob is excluded from Alice discovery feed.');

    // 8. Unmatch Flow
    console.log('\n[8/8] Testing Unmatch flow between Alice and Bob...');
    const unmatchRes = await axios.post(
      `${API_BASE}/matches/unmatch`,
      { targetUserId: idB },
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    console.log(`✓ Unmatched successfully: ${unmatchRes.data.message}`);

    console.log('\n=====================================================');
    console.log('  ALL MATCHING, MESSAGING & MODERATION TESTS PASSED!');
    console.log('=====================================================\n');
  } catch (error) {
    console.error('\n❌ Test Failure:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

runTests();
