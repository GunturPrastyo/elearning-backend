import dbConnect from "@/lib/dbConnect";
import Modul from "@/models/modul";

export default async function handler(req, res) {
  await dbConnect();
  const { id } = req.query;

  if (req.method === "GET") {
    const modul = await Modul.findById(id);
    return res.status(200).json(modul);
  }

  if (req.method === "PUT") {
    const updatedModul = await Modul.findByIdAndUpdate(id, req.body, { new: true });
    return res.status(200).json(updatedModul);
  }

  if (req.method === "DELETE") {
    await Modul.findByIdAndDelete(id);
    return res.status(200).json({ message: "Modul deleted" });
  }

  res.status(405).json({ message: "Method not allowed" });
}
