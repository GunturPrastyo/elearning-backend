import dbConnect from "@/lib/dbConnect";
import Topik from "@/models/topik";

export default async function handler(req, res) {
  await dbConnect();
  const { modulId } = req.query;

  if (req.method === "GET") {
    const topik = modulId ? await Topik.find({ modulId }) : await Topik.find();
    return res.status(200).json(topik);
  }

  if (req.method === "POST") {
    const { modulId, title, slug } = req.body;
    const newTopik = await Topik.create({ modulId, title, slug });
    return res.status(201).json(newTopik);
  }

  res.status(405).json({ message: "Method not allowed" });
}
