import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import Modul from '../models/Modul.js';
import Topik from '../models/Topik.js';
import Result from '../models/Result.js';

dotenv.config();

const seedCompleteUser = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected for seeding...');

        const userEmail = 'completeuser@example.com';
        const userName = 'Pengguna Lengkap';
        const userPassword = 'password123';

        // Hapus user dan semua hasilnya jika sudah ada
        const existingUser = await User.findOne({ email: userEmail });
        if (existingUser) {
            await Result.deleteMany({ userId: existingUser._id });
            await User.deleteOne({ _id: existingUser._id });
            console.log(`Existing user ${userEmail} and their results deleted.`);
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(userPassword, salt);

        // Buat user baru
        const newUser = await User.create({
            name: userName,
            email: userEmail,
            password: hashedPassword, // Simpan password yang sudah di-hash
            role: 'user',
            avatar: '/user-placeholder.png',
        });
        console.log(`User '${userName}' created.`);

        const allModules = await Modul.find({});
        const allTopics = await Topik.find({});

        const completedTopicIds = [];

        for (const modul of allModules) {
            const topicsInModule = allTopics.filter(topic => topic.modulId.equals(modul._id));

            for (const topik of topicsInModule) {
                // Buat hasil post-test topik yang lulus
                await Result.create({
                    userId: newUser._id,
                    testType: 'post-test-topik',
                    score: 100, // Lulus sempurna
                    correct: 10,
                    total: 10,
                    timeTaken: 60,
                    modulId: modul._id,
                    topikId: topik._id,
                    scoreDetails: {
                        accuracy: 100,
                        time: 100,
                        stability: 100,
                        focus: 100,
                    },
                });
                completedTopicIds.push(topik._id);
            }

            // Buat hasil post-test modul yang lulus
            await Result.create({
                userId: newUser._id,
                testType: 'post-test-modul',
                score: 100, // Lulus sempurna
                correct: 10,
                total: 10,
                timeTaken: 120,
                modulId: modul._id,
                scoreDetails: {
                    accuracy: 100,
                    time: 100,
                    stability: 100,
                    focus: 100,
                },
            });
        }

        // Update user dengan semua topik yang sudah diselesaikan
        newUser.topicCompletions = completedTopicIds;
        await newUser.save();
        console.log(`User '${userName}' updated with all topic completions.`);

        console.log('Seeding complete: User with all modules completed created successfully!');
    } catch (error) {
        console.error('Error during seeding:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB Disconnected.');
    }
};

seedCompleteUser();