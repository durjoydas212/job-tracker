const fs = require("fs");
const { google } = require("googleapis");

const auth = new google.auth.GoogleAuth({
  keyFile: "./backend/config/google-drive-key.json",
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({
  version: "v3",
  auth,
});

async function uploadFile(filePath, fileName) {
  const folderId = "14QAo7wN9s2Dyy_GqiAOXB_ZUkirWytmM";

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  return response.data.id;
}

module.exports = { uploadFile };