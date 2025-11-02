import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected for Seeder...');
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

const importData = async () => {
  try {
    // Hapus data pengguna yang sudah ada untuk menghindari duplikat
    await User.deleteMany();

    // Hash password untuk admin biasa
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    // Data pengguna yang akan dimasukkan
    const users = [
      {
        name: 'Admin Biasa',
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'admin',
      },
      {
        name: 'Admin Unnes',
        email: 'prastyoguntur982@students.unnes.ac.id',
        // Password tidak diisi, karena login akan via Google
        // Role akan otomatis di-set ke 'admin' saat login pertama kali
      },
      {
        name: 'Siswa SMK',
        email: 'siswa.smk@smk.belajar.id',
        // Role akan otomatis di-set ke 'user'
      },
      {
        name: 'Budi Santoso',
        email: 'budi.santoso@example.com',
      },
      {
        name: 'Ani Yudhoyono',
        email: 'ani.yudhoyono@example.com',
      },
      {
        name: 'User Biasa Satu',
        email: 'user1@example.com',
        password: hashedPassword,
        role: 'user',
      },
      {
        name: 'User Biasa tiga',
        email: 'user3@example.com',
        password: hashedPassword,
        role: 'user',
      },
      {
        name: 'User Biasa ',
        email: 'user4@example.com',
        password: hashedPassword,
        role: 'user',
      },
      {
        name: 'User Biasa Dua',
        email: 'user2@example.com',
        password: hashedPassword,
        role: 'user',
      },
    ];

    // Masukkan data pengguna baru
    await User.insertMany(users);

    console.log('✅ Data Imported Successfully!');
    process.exit();
  } catch (error) {
    console.error(`❌ Error importing data: ${error}`);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await User.deleteMany();

    console.log('✅ Data Destroyed Successfully!');
    process.exit();
  } catch (error) {
    console.error(`❌ Error destroying data: ${error}`);
    process.exit(1);
  }
};

const run = async () => {
  await connectDB();
  if (process.argv[2] === '-d') {
    await destroyData();
  } else {
    await importData();
  }
};

run();