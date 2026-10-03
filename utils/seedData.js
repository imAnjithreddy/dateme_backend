const Event = require('../models/Event');
const Club = require('../models/Club');
const ClubPost = require('../models/ClubPost');
const User = require('../models/User');
const { ROLES, ONLINE_STATUS } = require('../config/constants');

const INITIAL_CLUBS = [
  {
    name: 'Gaming',
    icon: '🎮',
    tagline: 'Casual multiplayer, arcade tournaments, and cooperative quests.',
    description: 'Connect with fellow gamers on campus for late-night gaming sessions, party games, and friendly mini-game tournaments in the arcade lounge.',
    category: 'gaming',
    virtualArea: 'game-zone',
    accentColor: '#8b5cf6',
    image: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=600&q=80'
  },
  {
    name: 'Music',
    icon: '🎵',
    tagline: 'Lo-fi beats, indie tracks, DJ sets, and playlist trades.',
    description: 'A collegiate haven for vinyl lovers, producers, and casual listeners. Share your favorite albums, attend live campus sets, and jam around the quad.',
    category: 'music',
    virtualArea: 'event-area',
    accentColor: '#f43f5e',
    image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80'
  },
  {
    name: 'Technology',
    icon: '💻',
    tagline: 'Coding, AI innovation, web dev, and startup brainstorms.',
    description: 'For curious builders and thinkers. Discuss emerging technology, work on collaborative side projects, and exchange ideas with tech peers.',
    category: 'technology',
    virtualArea: 'club-house',
    accentColor: '#0ea5e9',
    image: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=600&q=80'
  }
];

const INITIAL_EVENTS = [
  {
    title: 'Friday Gaming Night',
    description: 'Unwind at the campus arcade lounge! Multiplayer party games, Tic-Tac-Toe showdowns, and friendly trivia with fellow students.',
    date: 'Friday, Oct 9',
    time: '8:00 PM',
    location: 'Game Lounge & Arcade',
    virtualArea: 'game-zone',
    category: 'gaming',
    status: 'upcoming',
    hostName: 'Campus Gaming Collective',
    accentColor: '#E85D75',
    image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=600&q=80'
  },
  {
    title: 'Music & Chill',
    description: 'Late-night downtempo synthwave and lo-fi beats under the starlight stage lights. Cozy seating and ambient conversations.',
    date: 'Saturday, Oct 10',
    time: '9:30 PM',
    location: 'Starlight Stage',
    virtualArea: 'event-area',
    category: 'music',
    status: 'upcoming',
    hostName: 'The Quad Sound Collective',
    accentColor: '#F2768A',
    image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80'
  },
  {
    title: 'Movie Discussion',
    description: 'Post-screening discussion on independent cinema, cinematography, and favorite plot twists. Free mocktails and coffee at the café.',
    date: 'Sunday, Oct 11',
    time: '7:00 PM',
    location: 'Campus Café Lounge',
    virtualArea: 'cafe',
    category: 'movies',
    status: 'upcoming',
    hostName: 'Cinema Enthusiasts Guild',
    accentColor: '#E85D75',
    image: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=600&q=80'
  },
  {
    title: 'Photography Meetup',
    description: 'Golden hour photowalk around the Main Plaza fountain and architectural courtyard. Bring your camera, phone, or passion for visual art.',
    date: 'Tuesday, Oct 13',
    time: '5:30 PM',
    location: 'Main Plaza & Fountain',
    virtualArea: 'main-plaza',
    category: 'art',
    status: 'upcoming',
    hostName: 'Visual Arts Society',
    accentColor: '#A7A7AD',
    image: 'https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=600&q=80'
  }
];

const PlatformSetting = require('../models/PlatformSetting');

const devLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

const seedInitialEventsAndClubs = async () => {
  try {
    // 0. Seed Platform Configuration & Campus Areas
    await PlatformSetting.getOrCreateDefault();
    devLog('[Seed] Verified campus platform configuration and area hotspots.');

    // 1. Seed or Update Platform Admin
    const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || 'tanush@dtabs.tech').toLowerCase().trim();
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'tanush@dtabs.tech';
    const adminName = process.env.INITIAL_ADMIN_NAME || 'Tanush Saha';

    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      admin = await User.create({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        dateOfBirth: new Date('1998-01-01'),
        gender: 'prefer_not_to_say',
        city: 'Campus Headquarters',
        bio: 'Official Quad Platform Administrator & Trust Safety Guide.',
        role: ROLES.PLATFORM_ADMIN,
        isVerified: true,
        onboardingCompleted: true,
        onlineStatus: ONLINE_STATUS.ONLINE
      });
      devLog(`[Seed] Initial PLATFORM_ADMIN account created (${adminEmail}).`);
    } else {
      admin.role = ROLES.PLATFORM_ADMIN;
      admin.password = adminPassword;
      admin.name = adminName;
      admin.isVerified = true;
      admin.isSuspended = false;
      admin.isBanned = false;
      await admin.save();
      devLog(`[Seed] PLATFORM_ADMIN credentials updated for (${adminEmail}).`);
    }

    // 1b. Seed / Update tanush.saha05@gmail.com as standard USER
    const userEmail = 'tanush.saha05@gmail.com';
    const userPassword = 'tanush.saha05@gmail.com';
    let user2 = await User.findOne({ email: userEmail });
    if (!user2) {
      await User.create({
        name: 'Tanush Saha',
        email: userEmail,
        password: userPassword,
        dateOfBirth: new Date('2000-01-01'),
        gender: 'male',
        city: 'Campus Quad',
        bio: 'Campus Student & Explorer.',
        role: ROLES.USER,
        isVerified: true,
        onboardingCompleted: true,
        onlineStatus: ONLINE_STATUS.ONLINE
      });
      devLog(`[Seed] Created USER account for (${userEmail}) with password: ${userPassword}`);
    } else {
      user2.role = ROLES.USER;
      user2.password = userPassword;
      user2.isVerified = true;
      user2.isSuspended = false;
      user2.isBanned = false;
      await user2.save();
      devLog(`[Seed] Updated USER account for (${userEmail}) with password: ${userPassword}`);
    }

    // 1c. Seed / Update sahatanush511@gmail.com and sahatanush5@gmail.com
    const Friendship = require('../models/Friendship');
    const testAccounts = [
      {
        name: 'Tanush Saha',
        email: 'sahatanush511@gmail.com',
        password: 'password123',
        gender: 'male',
        city: 'Campus Quad'
      },
      {
        name: 'Saha 5',
        email: 'sahatanush5@gmail.com',
        password: 'password123',
        gender: 'female',
        city: 'Campus Quad'
      }
    ];

    const seededUsers = [];
    for (const acc of testAccounts) {
      let u = await User.findOne({ email: acc.email });
      if (!u) {
        u = await User.create({
          name: acc.name,
          email: acc.email,
          password: acc.password,
          dateOfBirth: new Date('2000-01-01'),
          gender: acc.gender,
          city: acc.city,
          bio: 'Campus Student & Explorer.',
          role: ROLES.USER,
          isVerified: true,
          onboardingCompleted: true,
          onlineStatus: ONLINE_STATUS.ONLINE
        });
        devLog(`[Seed] Created test account for (${acc.email}) with password: ${acc.password}`);
      } else {
        u.password = acc.password;
        u.isVerified = true;
        u.isSuspended = false;
        u.isBanned = false;
        await u.save();
        devLog(`[Seed] Updated test account for (${acc.email}) with password: ${acc.password}`);
      }
      seededUsers.push(u);
    }

    // Ensure ACCEPTED friendship exists between the two test accounts
    if (seededUsers.length >= 2) {
      const u1 = seededUsers[0];
      const u2 = seededUsers[1];
      const existingFriendship = await Friendship.findOne({
        $or: [
          { requester: u1._id, recipient: u2._id },
          { requester: u2._id, recipient: u1._id }
        ]
      });
      if (!existingFriendship) {
        await Friendship.create({
          requester: u1._id,
          recipient: u2._id,
          status: 'ACCEPTED',
          accepted_at: new Date()
        });
        devLog(`[Seed] Created ACCEPTED friendship between ${u1.email} and ${u2.email}`);
      } else if (existingFriendship.status !== 'ACCEPTED') {
        existingFriendship.status = 'ACCEPTED';
        existingFriendship.accepted_at = new Date();
        await existingFriendship.save();
        devLog(`[Seed] Updated friendship to ACCEPTED between ${u1.email} and ${u2.email}`);
      }
    }

    // 2. Seed Clubs
    for (const clubData of INITIAL_CLUBS) {
      const existingClub = await Club.findOne({ name: clubData.name });
      if (!existingClub) {
        const club = await Club.create({
          ...clubData,
          members: [admin._id],
          memberIds: [admin._id],
          memberCount: 1
        });

        // Seed an initial discussion post
        await ClubPost.create({
          club: club._id,
          author: admin._id,
          title: `Welcome to the ${club.name} Club!`,
          content: `Welcome everyone to the official ${club.name} student society! Introduce yourself here, share what you love most about ${club.name.toLowerCase()}, and let us know what campus activities you would like to see!`,
          likes: [admin._id]
        });
      }
    }
    devLog('[Seed] Verified 9 initial campus clubs.');

    // 3. Seed Events
    for (const eventData of INITIAL_EVENTS) {
      const existingEvent = await Event.findOne({ title: eventData.title });
      if (!existingEvent) {
        await Event.create({
          ...eventData,
          participants: [admin._id],
          attendeeIds: [admin._id],
          attendeesCount: 1
        });
      }
    }
    devLog('[Seed] Verified initial campus events.');
  } catch (err) {
    console.error('[Seed] Error seeding initial data:', err.message);
  }
};

module.exports = {
  seedInitialEventsAndClubs
};
