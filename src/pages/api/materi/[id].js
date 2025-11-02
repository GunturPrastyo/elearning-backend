import dbConnect from "@/lib/dbConnect";
import Materi from "@/models/materi";

export default async function handler(req, res) {
  await dbConnect();
  const { id } = req.query;

  if (req.method === "GET") {
    const materi = await Materi.findById(id);
    return res.status(200).json(materi);
  }

  if (req.method === "PUT") {
    const updatedMateri = await Materi.findByIdAndUpdate(id, req.body, { new: true });
    return res.status(200).json(updatedMateri);
  }

  if (req.method === "DELETE") {
    await Materi.findByIdAndDelete(id);
    return res.status(200).json({ message: "Materi deleted" });
  }

  res.status(405).json({ message: "Method not allowed" });
}
