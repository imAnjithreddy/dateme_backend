const API_URL = 'http://localhost:5000/api';

async function testConnectionAndMessaging() {
  console.log('========================================================');
  console.log('   THE QUAD: CONNECTION & MESSAGING FLOW TEST           ');
  console.log('========================================================\n');

  // Register Student A (Liam)
  const liamEmail = `liam_${Date.now()}@thequad.edu`;
  const liamRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Liam Vance',
      email: liamEmail,
      password: 'CampusPassword123!',
      dateOfBirth: '2001-04-12',
      gender: 'male',
      city: 'Oxford Campus',
      relationshipIntent: 'dating'
    })
  });
  const liamData = await liamRes.json();
  const liamToken = liamData.data.token;
  const liamId = liamData.data.user.id || liamData.data.user._id;
  console.log(`[1] Student A (Liam) registered. ID: ${liamId}`);

  // Register Student B (Maya)
  const mayaEmail = `maya_${Date.now()}@thequad.edu`;
  const mayaRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Maya Lin',
      email: mayaEmail,
      password: 'CampusPassword123!',
      dateOfBirth: '2002-09-18',
      gender: 'female',
      city: 'London Campus',
      relationshipIntent: 'dating'
    })
  });
  const mayaData = await mayaRes.json();
  const mayaToken = mayaData.data.token;
  const mayaId = mayaData.data.user.id || mayaData.data.user._id;
  console.log(`[2] Student B (Maya) registered. ID: ${mayaId}`);

  // 1. Liam sends connection request to Maya
  console.log('\n[3] Liam sends connection request to Maya...');
  const reqRes = await fetch(`${API_URL}/connections/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${liamToken}`
    },
    body: JSON.stringify({
      recipientId: mayaId,
      connectionOrigin: 'discovery_feed',
      campusZone: 'central-quad'
    })
  });
  const reqData = await reqRes.json();
  if (reqRes.status !== 201) throw new Error('Failed to send connection request: ' + JSON.stringify(reqData));
  const connectionId = reqData.data.connection._id;
  console.log(`PASSED: Connection request created with status: ${reqData.data.connection.status} (ID: ${connectionId})`);

  // 2. Check Maya received notification
  console.log('\n[4] Maya checks notifications...');
  const notifRes = await fetch(`${API_URL}/notifications`, {
    headers: { 'Authorization': `Bearer ${mayaToken}` }
  });
  const notifData = await notifRes.json();
  const requestNotif = notifData.data.notifications.find(n => n.type === 'connection_request');
  if (!requestNotif) throw new Error('Maya did not receive connection request notification!');
  console.log(`PASSED: Maya received notification: "${requestNotif.title}" - "${requestNotif.message}"`);

  // 3. Liam tries to send message BEFORE Maya accepts (Must be forbidden)
  console.log('\n[5] Liam attempts premature message before connection accepted...');
  const prematureMsgRes = await fetch(`${API_URL}/messages/${connectionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${liamToken}`
    },
    body: JSON.stringify({ text: 'Hey Maya, are you at the fountain?' })
  });
  if (prematureMsgRes.status === 403) {
    console.log('PASSED: Premature message strictly blocked with 403 Forbidden! Only accepted connections can message.');
  } else {
    throw new Error('FAILED: Message should have been forbidden! Status: ' + prematureMsgRes.status);
  }

  // 4. Maya accepts connection request
  console.log('\n[6] Maya accepts connection request...');
  const acceptRes = await fetch(`${API_URL}/connections/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${mayaToken}`
    },
    body: JSON.stringify({
      connectionId: connectionId,
      action: 'accept'
    })
  });
  const acceptData = await acceptRes.json();
  if (acceptRes.status !== 200 || acceptData.data.connection.status !== 'accepted') {
    throw new Error('Failed to accept connection: ' + JSON.stringify(acceptData));
  }
  console.log('PASSED: Maya accepted connection! Connection status is now: accepted');

  // 5. Liam sends message now that they are connected
  console.log('\n[7] Liam sends private message to Maya...');
  const sendMsgRes = await fetch(`${API_URL}/messages/${connectionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${liamToken}`
    },
    body: JSON.stringify({ text: 'Hey Maya, love your music tastes! Are you going to the Sunset DJ set tonight?' })
  });
  const sendMsgData = await sendMsgRes.json();
  if (sendMsgRes.status !== 201) throw new Error('Failed to send message: ' + JSON.stringify(sendMsgData));
  const sentMsg = sendMsgData.data?.message || sendMsgData.data?.sentMessage;
  console.log(`PASSED: Message sent! "${sentMsg?.text}"`);

  // 6. Maya replies
  console.log('\n[8] Maya replies to Liam...');
  const replyRes = await fetch(`${API_URL}/messages/${connectionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${mayaToken}`
    },
    body: JSON.stringify({ text: 'Yes, definitely! Let\'s meet by the amphitheater.' })
  });
  const replyData = await replyRes.json();
  if (replyRes.status !== 201) throw new Error('Failed to reply: ' + JSON.stringify(replyData));
  const repliedMsg = replyData.data?.message || replyData.data?.sentMessage;
  console.log(`PASSED: Reply sent! "${repliedMsg?.text}"`);

  // 7. Check message thread
  console.log('\n[9] Liam fetches message thread...');
  const threadRes = await fetch(`${API_URL}/messages/${connectionId}`, {
    headers: { 'Authorization': `Bearer ${liamToken}` }
  });
  const threadData = await threadRes.json();
  if (threadData.data.messages.length !== 2) {
    throw new Error(`Expected 2 messages in thread, found ${threadData.data.messages.length}`);
  }
  console.log(`PASSED: Thread verified with ${threadData.data.messages.length} messages.`);

  // 8. Check conversations list
  console.log('\n[10] Check conversations preview for Maya...');
  const convRes = await fetch(`${API_URL}/messages/conversations`, {
    headers: { 'Authorization': `Bearer ${mayaToken}` }
  });
  const convData = await convRes.json();
  const conv = convData.data.conversations.find(c => c.connectionId === connectionId);
  if (!conv) throw new Error('Conversation not found in Maya conversations list!');
  console.log(`PASSED: Maya conversation active with partner: ${conv.partner.name}, last message: "${conv.lastMessage}"`);

  console.log('\n========================================================');
  console.log('   CONNECTION & MESSAGING FLOW VERIFIED 100%!          ');
  console.log('========================================================');
}

testConnectionAndMessaging().catch(err => {
  console.error('\nFLOW TEST FAILED:', err);
  process.exit(1);
});
