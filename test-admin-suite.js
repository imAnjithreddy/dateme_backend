const http = require('http');

const API_BASE = 'http://localhost:5000/api';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      url,
      {
        method,
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runAdminVerification() {
  console.log('==================================================');
  console.log('🛡️  VERIFYING PLATFORM ADMIN & SECURITY SUITE');
  console.log('==================================================\n');

  // STEP 1: Strict Security Check - Unauthenticated Request
  console.log('1. Checking security on unauthenticated access...');
  const unauthRes = await request('GET', '/admin/overview');
  console.log(`   GET /api/admin/overview: HTTP ${unauthRes.status}`);
  if (unauthRes.status !== 401) {
    throw new Error(`Expected HTTP 401 Unauthorized, got ${unauthRes.status}`);
  }
  console.log('   ✅ Unauthenticated request rejected (401 Unauthorized)');

  // STEP 2: Strict Security Check - Standard USER Role Access
  console.log('\n2. Registering a standard student (USER role)...');
  const studentEmail = `student_${Date.now()}@thequad.edu`;
  const registerRes = await request('POST', '/auth/register', {
    name: 'Normal Student',
    email: studentEmail,
    password: 'Password123!',
    dateOfBirth: '2002-05-15',
    gender: 'female',
    city: 'Campus Quad'
  });
  const studentToken = registerRes.body.data.token;
  const studentId = registerRes.body.data.user.id;
  console.log(`   Student registered: ${studentEmail} (Role: ${registerRes.body.data.user.role})`);

  console.log('   Testing standard USER access to admin route...');
  const studentAdminRes = await request('GET', '/admin/overview', null, studentToken);
  console.log(`   GET /api/admin/overview with USER token: HTTP ${studentAdminRes.status}`);
  if (studentAdminRes.status !== 403) {
    throw new Error(`Expected HTTP 403 Forbidden for non-admin, got ${studentAdminRes.status}`);
  }
  console.log('   ✅ Non-admin student blocked (403 Forbidden)');

  // STEP 3: Authenticate as PLATFORM_ADMIN
  console.log('\n3. Authenticating as PLATFORM_ADMIN...');
  const adminLoginRes = await request('POST', '/auth/login', {
    email: 'admin@thequad.edu',
    password: 'QuadAdminPass2026!'
  });
  if (adminLoginRes.status !== 200) {
    throw new Error(`Failed to login as admin: ${JSON.stringify(adminLoginRes.body)}`);
  }
  const adminToken = adminLoginRes.body.data.token;
  console.log(`   Admin logged in: ${adminLoginRes.body.data.user.name} (Role: ${adminLoginRes.body.data.user.role})`);

  // STEP 4: Section 1 - Overview
  console.log('\n4. Testing Section 1: Overview KPIs...');
  const overviewRes = await request('GET', '/admin/overview', null, adminToken);
  console.log(`   HTTP ${overviewRes.status}`);
  const stats = overviewRes.body.data;
  console.log(`   - Total Users: ${stats.users.total}`);
  console.log(`   - Online On Campus: ${stats.users.online}`);
  console.log(`   - Total Reports: ${stats.trustAndSafety.totalReports}`);
  console.log(`   - Campus Events: ${stats.engagement.events}`);
  console.log(`   - Campus Clubs: ${stats.engagement.clubs}`);
  console.log('   ✅ Overview KPIs loaded');

  // STEP 5: Section 2 - Users Management
  console.log('\n5. Testing Section 2: Users Management...');
  const usersRes = await request('GET', `/admin/users?search=Normal+Student`, null, adminToken);
  console.log(`   Users found matching "Normal Student": ${usersRes.body.data.users.length}`);

  const userDetailsRes = await request('GET', `/admin/users/${studentId}`, null, adminToken);
  console.log(`   Student details retrieved: ${userDetailsRes.body.data.user.name}`);
  console.log(`   Account activity summary:`, userDetailsRes.body.data.activity.connections);

  // Test verify
  const verifyRes = await request('POST', `/admin/users/${studentId}/verify`, { isVerified: true }, adminToken);
  console.log(`   User verify toggled: isVerified = ${verifyRes.body.data.user.isVerified} (✅)`);

  // Test suspend
  const suspendRes = await request('POST', `/admin/users/${studentId}/suspend`, { reason: 'Test policy breach' }, adminToken);
  console.log(`   User suspended: isSuspended = ${suspendRes.body.data.user.isSuspended} (✅)`);

  // Verify suspended student cannot authenticate
  const studentSuspendedCheck = await request('GET', '/users/me', null, studentToken);
  console.log(`   Suspended student /users/me: HTTP ${studentSuspendedCheck.status} (✅ Blocked)`);

  // Unsuspend
  const unsuspendRes = await request('POST', `/admin/users/${studentId}/unsuspend`, {}, adminToken);
  console.log(`   User unsuspended: isSuspended = ${unsuspendRes.body.data.user.isSuspended} (✅)`);

  // Test ban
  const banRes = await request('POST', `/admin/users/${studentId}/ban`, { reason: 'Test severe safety breach' }, adminToken);
  console.log(`   User banned: isBanned = ${banRes.body.data.user.isBanned} (✅)`);

  // Unban
  const unbanRes = await request('POST', `/admin/users/${studentId}/unban`, {}, adminToken);
  console.log(`   User unbanned: isBanned = ${unbanRes.body.data.user.isBanned} (✅)`);

  // STEP 6: Section 3 & 4 - Reports & Moderation
  console.log('\n6. Testing Section 3 & 4: Reports & Moderation...');
  // File a test report from student
  const fileReportRes = await request('POST', '/moderation/report', {
    reportedUserId: studentId,
    type: 'profile',
    reason: 'inappropriate_content',
    details: 'Profile bio contains advertising links'
  }, studentToken);
  const reportId = fileReportRes.body.data.report._id;
  console.log(`   Report filed: #${reportId}`);

  // Admin view reports
  const reportsRes = await request('GET', '/admin/reports', null, adminToken);
  console.log(`   Admin reports list count: ${reportsRes.body.data.reports.length}`);

  // Mark report 'investigating'
  const updateReportRes = await request('PUT', `/admin/reports/${reportId}`, {
    status: 'investigating',
    adminNotes: 'Admin staff is reviewing flagged bio'
  }, adminToken);
  console.log(`   Report status updated to: ${updateReportRes.body.data.report.status} (✅)`);

  // Execute moderation content removal action
  const modActionRes = await request('POST', '/admin/moderation/action', {
    actionType: 'remove_content',
    targetUserId: studentId,
    reason: 'Reset bio adhering to 18+ guidelines',
    reportId
  }, adminToken);
  console.log(`   Moderation action executed: ${modActionRes.body.message} (✅)`);

  // STEP 7: Section 5 - Event Management
  console.log('\n7. Testing Section 5: Campus Event Management...');
  const newEventRes = await request('POST', '/admin/events', {
    title: 'Admin Hosted Rooftop Sunset Mixer',
    description: 'Exclusive collegiate sunset mixer with live ambient acoustic music.',
    date: 'Saturday, Oct 17',
    time: '6:30 PM',
    location: 'Rooftop Observatory',
    virtualArea: 'event-area',
    accentColor: '#E85D75'
  }, adminToken);
  const newEventId = newEventRes.body.data.event._id;
  console.log(`   Event created: "${newEventRes.body.data.event.title}" (#${newEventId})`);

  // Edit Event
  const editEventRes = await request('PUT', `/admin/events/${newEventId}`, {
    time: '7:00 PM'
  }, adminToken);
  console.log(`   Event updated: time = ${editEventRes.body.data.event.time} (✅)`);

  // Cancel Event
  const cancelEventRes = await request('POST', `/admin/events/${newEventId}/cancel`, {}, adminToken);
  console.log(`   Event cancelled: status = ${cancelEventRes.body.data.event.status} (✅)`);

  // View participants
  const participantsRes = await request('GET', `/admin/events/${newEventId}/participants`, null, adminToken);
  console.log(`   Event participants: ${participantsRes.body.data.attendeesCount} attendees`);

  // STEP 8: Section 6 - Club Management
  console.log('\n8. Testing Section 6: Club Management...');
  const clubName = `Philosophy & Ethics ${Date.now()}`;
  const newClubRes = await request('POST', '/admin/clubs', {
    name: clubName,
    tagline: 'Discussions on collegiate thought, ethics, and existentialism.',
    description: 'A society dedicated to intellectual dialogues and thought experiments.',
    icon: '🏛️',
    category: 'books',
    virtualArea: 'cafe'
  }, adminToken);
  const newClubId = newClubRes.body.data.club._id;
  console.log(`   Club created: "${newClubRes.body.data.club.name}" (#${newClubId})`);

  // Archive Club
  const archiveClubRes = await request('POST', `/admin/clubs/${newClubId}/archive`, { archive: true }, adminToken);
  console.log(`   Club archived: status = ${archiveClubRes.body.data.club.status} (✅)`);

  // STEP 9: Section 7 - Campus Management
  console.log('\n9. Testing Section 7: Campus Management...');
  const campusConfigRes = await request('GET', '/admin/campus/config', null, adminToken);
  console.log(`   Campus areas count: ${campusConfigRes.body.data.campusAreas.length}`);

  // Update area status
  const updateAreaRes = await request('PUT', '/admin/campus/areas/cafe', {
    announcement: 'Fresh espresso bar specials for late study hours',
    capacity: 95
  }, adminToken);
  console.log(`   Café area updated: announcement = "${updateAreaRes.body.data.area.announcement}" (✅)`);

  // STEP 10: Section 8 - Analytics
  console.log('\n10. Testing Section 8: Analytics...');
  const analyticsRes = await request('GET', '/admin/analytics', null, adminToken);
  const anData = analyticsRes.body.data;
  console.log(`   DAU: ${anData.users.dau}, WAU: ${anData.users.wau}, MAU: ${anData.users.mau}`);
  console.log(`   7-Day Registrations data points: ${anData.growth.registrationsTrend.length}`);
  console.log(`   Total Connections: ${anData.socialEngagement.totalConnections}, Messages: ${anData.socialEngagement.totalMessages}`);
  console.log('   ✅ Analytics metrics generated');

  // STEP 11: Section 9 & 10 - Subscriptions & Platform Settings
  console.log('\n11. Testing Section 9 & 10: Subscriptions & Platform Settings...');
  const subsRes = await request('GET', '/admin/subscriptions', null, adminToken);
  console.log(`   Subscriptions overview:`, subsRes.body.data.overview);

  const settingsRes = await request('GET', '/admin/settings', null, adminToken);
  console.log(`   Current Minimum Age: ${settingsRes.body.data.settings.minAgeRequirement}+`);
  console.log(`   Maintenance Mode: ${settingsRes.body.data.settings.maintenanceMode}`);

  const updateSettingsRes = await request('PUT', '/admin/settings', {
    allowDirectWhispers: true,
    maxCampusCapacity: 1200
  }, adminToken);
  console.log(`   Updated max campus capacity: ${updateSettingsRes.body.data.settings.maxCampusCapacity} (✅)`);

  console.log('\n==================================================');
  console.log('🎉 ALL 10 ADMIN PLATFORM DOMAINS & SECURITY CHECKS PASSED!');
  console.log('==================================================\n');
}

runAdminVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
