import dbConnect from "@/lib/dbConnect";
import Materi from "@/models/materi";

export default async function handler(req, res) {
  await dbConnect();
  const { topikId } = req.query;

  if (req.method === "GET") {
    const materi = topikId ? await Materi.find({ topikId }) : await Materi.find();
    return res.status(200).json(materi);
  }

  if (req.method === "POST") {
    const { topikId, content, youtube } = req.body;
    const newMateri = await Materi.create({ topikId, content, youtube });
    return res.status(201).json(newMateri);
  }

  res.status(405).json({ message: "Method not allowed" });
}
