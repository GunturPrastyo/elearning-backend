import dbConnect from "@/lib/dbConnect";
import Topik from "@/models/topik";

export default async function handler(req, res) {
  await dbConnect();
  const { id } = req.query;

  if (req.method === "GET") {
    const topik = await Topik.findById(id);
    return res.status(200).json(topik);
  }

  if (req.method === "PUT") {
    const updatedTopik = await Topik.findByIdAndUpdate(id, req.body, { new: true });
    return res.status(200).json(updatedTopik);
  }

  if (req.method === "DELETE") {
    await Topik.findByIdAndDelete(id);
    return res.status(200).json({ message: "Topik deleted" });
  }

  res.status(405).json({ message: "Method not allowed" });
}
