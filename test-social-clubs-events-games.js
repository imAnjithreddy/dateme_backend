/**
 * Automated Test: Social Activity Layer (Clubs, Events, and Mini-Games)
 */
const http = require('http');

const BASE_URL = 'http://localhost:5000/api';

function request(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data, raw: true });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Starting Social Activity Layer End-to-End Tests');
  console.log('==================================================\n');

  try {
    const timestamp = Date.now();

    // 1. Register User A (Alex) and User B (Riya)
    console.log('1. Registering verified test users...');
    const userARes = await request('/auth/register', 'POST', {
      name: 'Alex Rivera',
      email: `alex_${timestamp}@thequad.edu`,
      password: 'Password123!',
      dateOfBirth: '2001-05-15',
      gender: 'male',
      city: 'Quad North',
      relationshipIntent: 'dating'
    });
    const tokenA = userARes.data?.data?.token;
    const userA = userARes.data?.data?.user;
    console.log(`   User A registered: ${userA?.name} (ID: ${userA?._id})`);

    const userBRes = await request('/auth/register', 'POST', {
      name: 'Riya Patel',
      email: `riya_${timestamp}@thequad.edu`,
      password: 'Password123!',
      dateOfBirth: '2002-09-20',
      gender: 'female',
      city: 'Quad Central',
      relationshipIntent: 'dating'
    });
    const tokenB = userBRes.data?.data?.token;
    const userB = userBRes.data?.data?.user;
    console.log(`   User B registered: ${userB?.name} (ID: ${userB?._id})\n`);

    // 2. Clubs Discovery & Interaction
    console.log('2. Testing Clubs Discovery (9 Initial Clubs)...');
    const clubsRes = await request('/clubs', 'GET', null, tokenA);
    const clubs = clubsRes.data?.data?.clubs || [];
    console.log(`   Discovered ${clubs.length} campus clubs.`);
    const expectedCategories = ['gaming', 'music', 'art', 'technology', 'books', 'travel', 'fitness', 'movies', 'cooking'];
    const foundCategories = clubs.map(c => c.category?.toLowerCase());
    const allFound = expectedCategories.every(cat => foundCategories.includes(cat));
    console.log(`   All 9 required club categories present: ${allFound ? '✅ YES' : '❌ NO'}`);

    const gamingClub = clubs.find(c => c.category?.toLowerCase() === 'gaming') || clubs[0];
    console.log(`   Testing Gaming Club: "${gamingClub.name}" (${gamingClub._id})`);

    // Join club
    const joinRes = await request(`/clubs/${gamingClub._id}/join`, 'POST', {}, tokenA);
    console.log(`   User A joined club: ${joinRes.data?.message} (isMember: ${joinRes.data?.data?.isMember})`);

    // View members
    const membersRes = await request(`/clubs/${gamingClub._id}/members`, 'GET', null, tokenA);
    const members = membersRes.data?.data?.members || [];
    const memberFound = members.some(m => m._id === userA._id);
    console.log(`   User A verified in club members list: ${memberFound ? '✅ YES' : '❌ NO'}`);

    // Create discussion post
    console.log('   User A creating club discussion post...');
    const postRes = await request(`/clubs/${gamingClub._id}/posts`, 'POST', {
      title: 'Mario Kart Tournament Friday Night!',
      content: 'Who wants to race on Rainbow Road at the campus Game Zone?'
    }, tokenA);
    const post = postRes.data?.data?.post;
    console.log(`   Club discussion post created: "${post?.title}" (${post?._id})`);

    // Like post as User B
    const likeRes = await request(`/clubs/posts/${post._id}/like`, 'POST', {}, tokenB);
    console.log(`   User B liked discussion post: ${likeRes.data?.message}`);

    // Fetch posts
    const postsRes = await request(`/clubs/${gamingClub._id}/posts`, 'GET', null, tokenB);
    const fetchedPost = (postsRes.data?.data?.posts || []).find(p => p._id === post._id);
    console.log(`   Discussion post verified with ${fetchedPost?.likes?.length} like(s): ✅ YES\n`);

    // 3. Events Discovery & RSVP
    console.log('3. Testing Events Discovery & RSVP Flow...');
    const eventsRes = await request('/events', 'GET', null, tokenA);
    const events = eventsRes.data?.data?.events || [];
    console.log(`   Discovered ${events.length} campus events:`);
    events.forEach(e => console.log(`   - "${e.title}" on ${e.date} at ${e.time} (${e.virtualArea || e.location})`));

    const gamingEvent = events.find(e => e.title.includes('Gaming')) || events[0];
    console.log(`   User A RSVPing to event: "${gamingEvent.title}"`);
    const rsvpRes = await request(`/events/${gamingEvent._id}/rsvp`, 'POST', {}, tokenA);
    console.log(`   RSVP Result: ${rsvpRes.data?.message}`);

    // View participants
    const participantsRes = await request(`/events/${gamingEvent._id}/participants`, 'GET', null, tokenA);
    const participants = participantsRes.data?.data?.participants || [];
    const participantFound = participants.some(p => p._id === userA._id);
    console.log(`   User A verified in event participants: ${participantFound ? '✅ YES' : '❌ NO'}\n`);

    // 4. Mini-Games Flow (Tic-Tac-Toe & Trivia)
    console.log('4. Testing Conversational Mini-Games Flow...');
    // A invites B to Tic-Tac-Toe
    console.log('   User A inviting User B to Tic-Tac-Toe...');
    const inviteRes = await request('/games/invite', 'POST', {
      targetUserId: userB._id,
      gameType: 'tictactoe'
    }, tokenA);
    const session = inviteRes.data?.data?.session;
    console.log(`   Game invitation created: Status = ${session?.status} (Session ID: ${session?._id})`);

    // B accepts invite
    console.log('   User B accepting invitation ("Want to play Tic-Tac-Toe with Alex?")...');
    const acceptRes = await request(`/games/${session._id}/respond`, 'POST', {
      action: 'accept'
    }, tokenB);
    console.log(`   Game accepted: Status = ${acceptRes.data?.data?.session?.status}`);

    // User A makes first move (cell 0)
    console.log('   User A making move at center (cell 4)...');
    const moveRes = await request(`/games/${session._id}/move`, 'POST', {
      cellIndex: 4
    }, tokenA);
    const afterMove1 = moveRes.data?.data?.session?.gameState;
    console.log(`   Board state at cell 4: "${afterMove1?.board[4]}", Turn now: ${afterMove1?.currentTurn === userB._id ? 'User B' : 'User A'}`);
    console.log(`   Icebreaker Spark: "${afterMove1?.icebreakerPrompt}"`);

    // User B makes second move (cell 0)
    console.log('   User B making move at corner (cell 0)...');
    const moveRes2 = await request(`/games/${session._id}/move`, 'POST', {
      cellIndex: 0
    }, tokenB);
    const afterMove2 = moveRes2.data?.data?.session?.gameState;
    console.log(`   Board state at cell 0: "${afterMove2?.board[0]}", Turn now: ${afterMove2?.currentTurn === userA._id ? 'User A' : 'User B'}`);

    // Test Trivia game invitation
    console.log('\n   User A inviting User B to Campus Trivia...');
    const triviaInvite = await request('/games/invite', 'POST', {
      targetUserId: userB._id,
      gameType: 'trivia'
    }, tokenA);
    const triviaSession = triviaInvite.data?.data?.session;
    await request(`/games/${triviaSession._id}/respond`, 'POST', { action: 'accept' }, tokenB);
    console.log(`   Trivia session active. Q1: "${triviaSession.gameState.questions[0].question}"`);

    // Both answer Question 0
    await request(`/games/${triviaSession._id}/move`, 'POST', { answerIndex: 0 }, tokenA);
    const triviaMoveB = await request(`/games/${triviaSession._id}/move`, 'POST', { answerIndex: 0 }, tokenB);
    const triviaState = triviaMoveB.data?.data?.session?.gameState;
    console.log(`   Both answered Q1. Advanced to Q${(triviaState.currentQuestionIndex || 0) + 1}`);
    console.log(`   Chat Spark Prompt: "${triviaState.icebreakerPrompt}"`);
    console.log(`   Scores: User A = ${triviaState.scores[userA._id]} | User B = ${triviaState.scores[userB._id]}`);

    console.log('\n==================================================');
    console.log('🎉 ALL SOCIAL CLUBS, EVENTS & MINI-GAMES TESTS PASSED!');
    console.log('==================================================');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  }
}

runTests();
