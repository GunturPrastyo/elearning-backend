import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'main-settings',
        unique: true,
    },
    siteTitle: {
        type: String,
        default: 'E-Learning Personalisasi'
    },
    siteDescription: {
        type: String,
        default: 'Platform e-learning dengan pendekatan personalisasi.'
    },
    siteKeywords: {
        type: String,
        default: 'e-learning, personalisasi, javascript'
    },
    logoUrl: {
        type: String,
    },
    faviconUrl: {
        type: String,
    }
}, { timestamps: true });

const Setting = mongoose.model('Setting', settingSchema);

export default Setting;