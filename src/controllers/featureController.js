import Feature from "../models/Feature.js";

/**
 * @desc    Get all features
 * @route   GET /api/features
 * @access  Private/Admin
 */
export const getFeatures = async (req, res) => {
  try {
    const features = await Feature.find().sort({ createdAt: -1 });
    res.status(200).json(features);
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};

/**
 * @desc    Create a new feature
 * @route   POST /api/features
 * @access  Private/Admin
 */
export const createFeature = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Nama fitur diperlukan." });
    }
    const newFeature = new Feature({ name });
    await newFeature.save();
    res.status(201).json(newFeature);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Nama fitur sudah ada." });
    }
    res.status(400).json({ message: "Gagal membuat fitur: " + error.message });
  }
};

/**
 * @desc    Update a feature
 * @route   PUT /api/features/:id
 * @access  Private/Admin
 */
export const updateFeature = async (req, res) => {
  try {
    const { name } = req.body;
    const feature = await Feature.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true, runValidators: true }
    );
    if (!feature) {
      return res.status(404).json({ message: "Fitur tidak ditemukan." });
    }
    res.status(200).json(feature);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Nama fitur sudah ada." });
    }
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};

/**
 * @desc    Delete a feature
 * @route   DELETE /api/features/:id
 * @access  Private/Admin
 */
export const deleteFeature = async (req, res) => {
  try {
    const feature = await Feature.findByIdAndDelete(req.params.id);
    if (!feature) {
      return res.status(404).json({ message: "Fitur tidak ditemukan." });
    }
    res.status(200).json({ message: "Fitur berhasil dihapus." });
  } catch (error) {
    res.status(500).json({ message: "Server Error: " + error.message });
  }
};