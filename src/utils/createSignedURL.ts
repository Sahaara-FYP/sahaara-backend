import supabase from "./supabase.js";

export async function createSignedUrls(paths: string[]) {
  const signedUrls: string[] = [];

  for (const path of paths) {
    const { data } = supabase.storage.from("attachments").getPublicUrl(path);

    if (!data) {
      console.error("Error creating signed URL");
      continue;
    }

    signedUrls.push(data.publicUrl);
  }

  return signedUrls;
}
