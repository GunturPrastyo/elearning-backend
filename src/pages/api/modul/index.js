import dbConnect from "@/lib/dbConnect";
import Modul from "@/models/modul";

export default async function handler(req, res) {
  await dbConnect();

  if (req.method === "GET") {
    // Ambil semua modul
    const modul = await Modul.find();
    return res.status(200).json(modul);
  }

  if (req.method === "POST") {
    // Tambah modul baru
    const { title, icon, category, overview, slug } = req.body;
    const newModul = await Modul.create({ title, icon, category, overview, slug });
    return res.status(201).json(newModul);
  }

  res.status(405).json({ message: "Method not allowed" });
}
