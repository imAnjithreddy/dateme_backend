require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { ROLES, ONLINE_STATUS } = require('../config/constants');
const { connectDB, disconnectDB } = require('../config/db');

async function seedAdmin() {
  try {
    await connectDB();

    const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || 'admin@thequad.edu').toLowerCase().trim();
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'QuadAdminPass2026!';
    const adminName = process.env.INITIAL_ADMIN_NAME || 'Platform Administrator';

    console.log(`[Admin Seed] Checking admin account for: ${adminEmail}`);

    let admin = await User.findOne({ email: adminEmail }).select('+password');

    if (admin) {
      console.log(`[Admin Seed] Admin user already exists. Updating role and password...`);
      admin.role = ROLES.PLATFORM_ADMIN;
      admin.password = adminPassword;
      admin.isVerified = true;
      admin.onboardingCompleted = true;
      await admin.save();
      console.log(`[Admin Seed] Admin account successfully updated.`);
    } else {
      console.log(`[Admin Seed] Creating initial platform admin account...`);
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
        onlineStatus: ONLINE_STATUS.OFFLINE
      });
      console.log(`[Admin Seed] Admin account successfully created with ID: ${admin._id}`);
    }

    console.log(`===============================================`);
    console.log(`  PLATFORM ADMIN CREDENTIALS CONFIGURED:       `);
    console.log(`  Email:    ${adminEmail}                      `);
    console.log(`  Role:     ${ROLES.PLATFORM_ADMIN}            `);
    console.log(`===============================================`);

    await disconnectDB();
    process.exit(0);
  } catch (error) {
    console.error('[Admin Seed] Error:', error.message);
    process.exit(1);
  }
}

seedAdmin();
