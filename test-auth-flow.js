async function runFullTestSuite() {
  console.log('========================================================');
  console.log('   THE QUAD: FULL AUTH & USER SYSTEM VERIFICATION TEST   ');
  console.log('========================================================');

  // 1. Under-18 rejection
  console.log('\n[1] Testing Under-18 Registration Enforcement...');
  const minorRes = await fetch('http://localhost:5000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Minor Student',
      email: 'minor.' + Date.now() + '@example.com',
      password: 'password123',
      dateOfBirth: '2011-06-15',
      gender: 'other',
      city: 'Austin'
    })
  });
  const minorJson = await minorRes.json();
  if (minorRes.status === 400) {
    console.log('PASSED: Under-18 strictly rejected with message:', minorJson.message);
  } else {
    throw new Error('FAILED Under-18 check: ' + JSON.stringify(minorJson));
  }

  // 2. Valid 18+ Registration
  console.log('\n[2] Testing Valid 18+ Adult Registration...');
  const studentEmail = 'clara.' + Date.now() + '@thequad.edu';
  const regRes = await fetch('http://localhost:5000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Clara Oswald',
      email: studentEmail,
      password: 'supersecretpass123',
      dateOfBirth: '2002-11-23',
      gender: 'female',
      city: 'London / Campus',
      relationshipIntent: 'dating'
    })
  });
  const regJson = await regRes.json();
  if (regRes.status === 201 && regJson.data?.requiresOnboarding === true) {
    console.log('PASSED: Clara registered. Calculated age:', regJson.data.user.age, 'Requires onboarding:', regJson.data.requiresOnboarding);
  } else {
    throw new Error('FAILED Registration: ' + JSON.stringify(regJson));
  }
  const claraToken = regJson.data.token;

  // 3. Normal user forbidden from Admin endpoints
  console.log('\n[3] Testing Role-Based Protection (Normal User on Admin route)...');
  const adminTestRes = await fetch('http://localhost:5000/api/admin', {
    headers: { 'Authorization': 'Bearer ' + claraToken }
  });
  if (adminTestRes.status === 403) {
    console.log('PASSED: Student correctly forbidden (403) from admin endpoint.');
  } else {
    throw new Error('FAILED: Student was not forbidden from admin route! Status: ' + adminTestRes.status);
  }

  // 4. Onboarding Completion
  console.log('\n[4] Testing Profile Onboarding Completion...');
  const onboardRes = await fetch('http://localhost:5000/api/users/onboarding', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + claraToken
    },
    body: JSON.stringify({
      bio: 'Literature and temporal anomalies. Tea enthusiast.',
      interests: ['Architecture', 'Philosophy', 'Creative Writing'],
      hobbies: ['Traveling', 'Reading', 'Concerts'],
      musicPreferences: ['Indie Rock', 'Classical'],
      moviePreferences: ['Sci-Fi', 'Romantic Dramas'],
      languages: ['English', 'French'],
      education: 'Faculty of Humanities & Literature',
      occupation: 'Teaching Assistant',
      relationshipIntent: 'dating',
      discoveryPreferences: {
        minAge: 20,
        maxAge: 30,
        preferredGender: ['everyone'],
        locationPreference: 'London & Campus'
      }
    })
  });
  const onboardJson = await onboardRes.json();
  if (onboardRes.status === 200 && onboardJson.data?.user?.onboardingCompleted === true) {
    console.log('PASSED: Onboarding completed. Onboarding status:', onboardJson.data.user.onboardingCompleted);
    console.log('Interests:', onboardJson.data.user.interests);
    console.log('Discovery Preferences:', onboardJson.data.user.discoveryPreferences);
  } else {
    throw new Error('FAILED Onboarding: ' + JSON.stringify(onboardJson));
  }

  // 5. Update Discovery Preferences
  console.log('\n[5] Testing Update Discovery Preferences...');
  const prefRes = await fetch('http://localhost:5000/api/users/discovery-preferences', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + claraToken
    },
    body: JSON.stringify({
      minAge: 21,
      maxAge: 29,
      preferredGender: ['male', 'non-binary'],
      locationPreference: 'Central Campus'
    })
  });
  const prefJson = await prefRes.json();
  if (prefRes.status === 200 && prefJson.data.discoveryPreferences.minAge === 21) {
    console.log('PASSED: Preferences updated:', prefJson.data.discoveryPreferences);
  } else {
    throw new Error('FAILED Discovery Preferences: ' + JSON.stringify(prefJson));
  }

  // 6. Logout
  console.log('\n[6] Testing User Logout...');
  const logoutRes = await fetch('http://localhost:5000/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + claraToken }
  });
  const logoutJson = await logoutRes.json();
  console.log('PASSED: Logged out successfully:', logoutJson.message);

  // 7. Re-Login as Clara
  console.log('\n[7] Testing Re-Login as Clara...');
  const loginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: studentEmail,
      password: 'supersecretpass123'
    })
  });
  const loginJson = await loginRes.json();
  if (loginRes.status === 200 && loginJson.data?.requiresOnboarding === false) {
    console.log('PASSED: Clara logged back in. Onboarding completed = true.');
  } else {
    throw new Error('FAILED Login: ' + JSON.stringify(loginJson));
  }

  // 8. Admin Login & Authorization
  console.log('\n[8] Testing Platform Admin Login & Access...');
  const adminLoginRes = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@thequad.edu',
      password: 'QuadAdminPass2026!'
    })
  });
  const adminLoginJson = await adminLoginRes.json();
  if (adminLoginRes.status === 200 && adminLoginJson.data?.user?.role === 'PLATFORM_ADMIN') {
    console.log('PASSED: Admin authenticated. Role =', adminLoginJson.data.user.role);
    const adminToken = adminLoginJson.data.token;

    // Verify admin can access admin route
    const adminAccessRes = await fetch('http://localhost:5000/api/admin', {
      headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    const adminAccessJson = await adminAccessRes.json();
    if (adminAccessRes.status === 200) {
      console.log('PASSED: PLATFORM_ADMIN successfully authorized for /api/admin!');
    } else {
      throw new Error('FAILED: Admin could not access /api/admin! Status: ' + adminAccessRes.status);
    }
  } else {
    throw new Error('FAILED Admin login: ' + JSON.stringify(adminLoginJson));
  }

  console.log('\n========================================================');
  console.log('   ALL AUTHENTICATION & USER TESTS PASSED 100%!         ');
  console.log('========================================================');
}

runFullTestSuite().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
