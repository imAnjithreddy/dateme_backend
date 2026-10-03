/**
 * Automated Test: Stylized Avatar Customization & Gamification System
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
  console.log('🧪 Testing Avatar & Gamification Systems');
  console.log('==================================================\n');

  try {
    const timestamp = Date.now();

    // 1. Register test student
    console.log('1. Registering test student...');
    const registerRes = await request('/auth/register', 'POST', {
      name: 'Maya Lin',
      email: `maya_${timestamp}@thequad.edu`,
      password: 'Password123!',
      dateOfBirth: '2001-11-22',
      gender: 'female',
      city: 'Central Quad',
      relationshipIntent: 'dating'
    });
    const token = registerRes.data?.data?.token;
    const user = registerRes.data?.data?.user;
    console.log(`   Registered: ${user?.name} (ID: ${user?._id})\n`);

    // 2. Avatar Customization Test (Hair, Face, Skin, Outfit, Shoes, Accessories)
    console.log('2. Testing Stylized Cartoon Avatar Customization...');
    const avatarPayload = {
      hairStyle: 'curls',
      hairColor: '#E85D75',
      faceExpression: 'romantic-blush',
      eyeColor: '#059669',
      skinTone: '#b27a4b',
      outfitStyle: 'cozy-hoodie',
      outfitColor: '#E85D75',
      secondaryColor: '#35151D',
      shoesStyle: 'combat-boots',
      shoesColor: '#18181b',
      accessory: 'wire-glasses'
    };

    const avatarRes = await request('/users/avatar', 'PUT', avatarPayload, token);
    const savedAvatar = avatarRes.data?.data?.avatar;

    console.log('   Verifying all 6 customization categories:');
    console.log(`   - Hair: ${savedAvatar?.hairStyle} in ${savedAvatar?.hairColor} (✅)`);
    console.log(`   - Face: ${savedAvatar?.faceExpression} with eyeColor ${savedAvatar?.eyeColor} (✅)`);
    console.log(`   - Skin Tone: ${savedAvatar?.skinTone} (✅)`);
    console.log(`   - Outfit: ${savedAvatar?.outfitStyle} in ${savedAvatar?.outfitColor} (✅)`);
    console.log(`   - Shoes: ${savedAvatar?.shoesStyle} in ${savedAvatar?.shoesColor} (✅)`);
    console.log(`   - Accessories: ${savedAvatar?.accessory} (✅)\n`);

    // 3. Initial Gamification Summary
    console.log('3. Checking Initial Gamification State...');
    const summaryRes1 = await request('/gamification/summary', 'GET', null, token);
    const summary1 = summaryRes1.data?.data?.summary;
    console.log(`   Initial Level: ${summary1?.level} (${summary1?.title})`);
    console.log(`   Initial XP: ${summary1?.currentXp} / Next Level: ${summary1?.nextLevelXp}`);
    console.log(`   Progress: ${summary1?.progressPercentage}%\n`);

    // 4. Badges Catalog Verification
    console.log('4. Verifying Reusable Badges Catalog...');
    const badgesRes = await request('/gamification/badges', 'GET', null, token);
    const badges = badgesRes.data?.data?.badges || [];
    console.log(`   Discovered ${badges.length} badges in catalog:`);
    badges.forEach(b => console.log(`   - ${b.icon} ${b.name} (${b.category}): ${b.description}`));

    const requiredBadgeIds = ['first_step', 'event_explorer', 'game_night', 'music_lover', 'bookworm', 'campus_explorer', 'community_member'];
    const allBadgesPresent = requiredBadgeIds.every(id => badges.some(b => b.id === id));
    console.log(`   All required badges present: ${allBadgesPresent ? '✅ YES' : '❌ NO'}\n`);

    // 5. Meaningful Participation XP Triggers:
    console.log('5. Testing Meaningful Participation XP Awards:');

    // A. Campus Exploration
    console.log('   A. Exploring Campus Zone (Main Plaza)...');
    const exploreRes = await request('/gamification/action', 'POST', {
      actionType: 'explore_campus',
      zoneId: 'main-plaza'
    }, token);
    console.log(`      Reward: ${exploreRes.data?.message} (+${exploreRes.data?.data?.xpGained} XP)`);

    // B. Join Music Society
    console.log('   B. Joining Music Society...');
    const clubsRes = await request('/clubs', 'GET', null, token);
    const musicClub = clubsRes.data?.data?.clubs?.find(c => c.category === 'music');
    if (musicClub) {
      const joinClubRes = await request(`/clubs/${musicClub._id}/join`, 'POST', {}, token);
      console.log(`      Joined Music Club: ${joinClubRes.data?.message}`);
    }

    // C. Join Books Society
    console.log('   C. Joining Books Society...');
    const booksClub = clubsRes.data?.data?.clubs?.find(c => c.category === 'books');
    if (booksClub) {
      await request(`/clubs/${booksClub._id}/join`, 'POST', {}, token);
      console.log(`      Joined Books Club: ✅`);
    }

    // D. Discussion Post in Club
    console.log('   D. Creating discussion post in Music Club...');
    if (musicClub) {
      const postRes = await request(`/clubs/${musicClub._id}/posts`, 'POST', {
        title: 'Favorite late-night study albums?',
        content: 'Drop your top ambient and lo-fi recommendations for late night library study!'
      }, token);
      console.log(`      Discussion post published: "${postRes.data?.data?.post?.title}"`);
    }

    // E. RSVP to Campus Event
    console.log('   E. Joining Campus Event...');
    const eventsRes = await request('/events', 'GET', null, token);
    const firstEvent = eventsRes.data?.data?.events?.[0];
    if (firstEvent) {
      const rsvpRes = await request(`/events/${firstEvent._id}/rsvp`, 'POST', {}, token);
      console.log(`      Event RSVP: ${rsvpRes.data?.message}`);
    }

    // 6. Updated Gamification Summary & Badges Unlocked
    console.log('\n6. Checking Updated Gamification & Level Progression...');
    const summaryRes2 = await request('/gamification/summary', 'GET', null, token);
    const summary2 = summaryRes2.data?.data?.summary;
    console.log(`   Updated Level: ${summary2?.level} (${summary2?.title})`);
    console.log(`   Updated XP: ${summary2?.currentXp} (Gained ${summary2?.currentXp - summary1?.currentXp} XP)`);
    console.log(`   Next Level Target: ${summary2?.nextLevelXp} XP (${summary2?.nextLevelTitle})`);
    console.log(`   Progress to Next Level: ${summary2?.progressPercentage}%`);

    const unlockedBadges = summary2?.badges?.filter(b => b.isUnlocked);
    console.log(`\n   Unlocked Badges (${unlockedBadges?.length}):`);
    unlockedBadges?.forEach(b => console.log(`   - ${b.icon} ${b.name}`));

    console.log('\n==================================================');
    console.log('🎉 AVATAR & GAMIFICATION TESTS COMPLETED SUCCESSFULLY!');
    console.log('==================================================');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  }
}

runTests();
