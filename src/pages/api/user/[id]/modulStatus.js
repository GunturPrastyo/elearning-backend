import dbConnect from "@/lib/dbConnect";
import User from "@/models/user";

export default async function handler(req, res) {
  await dbConnect();
  const { id } = req.query;

  if (req.method === "PATCH") {
    const { modulId, status } = req.body; // status: 'selesai', 'terkunci', '50%'
    const user = await User.findById(id);
    const modulIndex = user.modulStatus.findIndex(ms => ms.modulId.toString() === modulId);
    if (modulIndex >= 0) {
      user.modulStatus[modulIndex].status = status;
    } else {
      user.modulStatus.push({ modulId, status });
    }
    await user.save();
    return res.status(200).json(user);
  }

  res.status(405).json({ message: "Method not allowed" });
}
