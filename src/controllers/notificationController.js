import Notification from "../models/Notification.js";


/**
 * @desc    Get all notifications for the current user
 * @route   GET /api/notifications
 * @access  Private
 */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20); 
    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};

/**
 * @desc    Create a new notification
 * @route   POST /api/notifications
 * @access  Private
 */
export const createNotification = async (req, res) => {
  try {
    const { userId, message, link } = req.body;

    if (req.user._id.toString() !== userId) {
      return res.status(403).json({ message: "Akses ditolak." });
    }

    const newNotification = new Notification({ userId, message, link });
    await newNotification.save();

    req.io.to(userId).emit("new_notification", newNotification);

    res.status(201).json(newNotification);
  } catch (error) {
    res.status(400).json({ message: "Gagal membuat notifikasi: " + error.message });
  }
};

/**
 * @desc    Mark a notification as read
 * @route   PUT /api/notifications/read
 * @access  Private
 */
export const markAsRead = async (req, res) => {
    try {
        const userId = req.user._id;
        // Tandai semua notifikasi yang belum dibaca sebagai sudah dibaca
        await Notification.updateMany(
            { userId: userId, isRead: false },
            { $set: { isRead: true } }
        );
        res.status(200).json({ message: "Semua notifikasi ditandai telah dibaca." });
    } catch (error) {
        res.status(500).json({ message: "Server Error: " + error.message });
    }
};

/**
 * @desc    Delete a notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: "Notifikasi tidak ditemukan." });
    }

    if (notification.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Akses ditolak." });
    }

    await notification.deleteOne();

    res.status(200).json({ message: "Notifikasi berhasil dihapus." });
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};