import supabase from "./supabase.js";

export async function uploadFileToSupabase(
  folder: String,
  subFolderId: String,
  file: Express.Multer.File
) {
  const safeName = file.originalname.replace(/\s+/g, "_");
  const filePath = `${folder}/${subFolderId}/${Date.now()}_${safeName}`;

  const { data, error } = await supabase.storage
    .from("attachments")
    .upload(filePath, file.buffer, {
      cacheControl: "3600",
      upsert: false,
    });

  return { data, error };
}
