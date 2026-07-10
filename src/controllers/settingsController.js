import Setting from '../models/Setting.js';
import { put, del } from '@vercel/blob';

/**
 * @desc    Get website settings
 * @route   GET /api/settings
 * @access  Public
 */
export const getSettings = async (req, res) => {
    try {
        let settings = await Setting.findOne({ key: 'main-settings' });
        if (!settings) {
            // Jika belum ada, buat pengaturan default
            settings = await Setting.create({ key: 'main-settings' });
        }
        res.status(200).json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
    }
};

/**
 * @desc    Update website settings
 * @route   PUT /api/settings
 * @access  Private/Admin
 */
export const updateSettings = async (req, res) => {
    try {
        let settings = await Setting.findOne({ key: 'main-settings' });
        if (!settings) {
            settings = new Setting({ key: 'main-settings' });
        }

        const { siteTitle, siteDescription, siteKeywords } = req.body;

        settings.siteTitle = siteTitle || settings.siteTitle;
        settings.siteDescription = siteDescription || settings.siteDescription;
        settings.siteKeywords = siteKeywords || settings.siteKeywords;

        const files = req.files;

        if (files && files.logo) {
            const logoFile = files.logo[0];
            if (settings.logoUrl && settings.logoUrl.includes('blob.vercel-storage.com')) {
                try { await del(settings.logoUrl); } catch (err) { console.error("Gagal hapus logo lama:", err); }
            }
            const { url } = await put(`settings/logo-${Date.now()}-${logoFile.originalname}`, logoFile.buffer, {
                access: 'public',
                contentType: logoFile.mimetype,
            });
            settings.logoUrl = url;
        }

        if (files && files.favicon) {
            const faviconFile = files.favicon[0];
            if (settings.faviconUrl && settings.faviconUrl.includes('blob.vercel-storage.com')) {
                try { await del(settings.faviconUrl); } catch (err) { console.error("Gagal hapus favicon lama:", err); }
            }
            const { url } = await put(`settings/favicon-${Date.now()}-${faviconFile.originalname}`, faviconFile.buffer, {
                access: 'public',
                contentType: faviconFile.mimetype,
            });
            settings.faviconUrl = url;
        }

        const updatedSettings = await settings.save();
        res.status(200).json(updatedSettings);

    } catch (error) {
        console.error("Error updating settings:", error);
        res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
    }
};