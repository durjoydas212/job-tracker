const fs = require("fs");
const { google } = require("googleapis");

const auth = new google.auth.GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
  },
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({
  version: "v3",
  auth,
});

async function findFolderByName(folderName) {
  const response = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files[0] || null;
}

async function createFolder(folderName) {
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [ROOT_FOLDER_ID],
    },
    supportsAllDrives: true,
  });

  return folder.data.id;
}

async function uploadFile(filePath, fileName, jobNumber) {
  let folder = await findFolderByName(jobNumber);

  let folderId;

  if (folder) {
    folderId = folder.id;
  } else {
    folderId = await createFolder(jobNumber);
  }

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      body: fs.createReadStream(filePath),
    },
    supportsAllDrives: true,
  });

  return response.data.id;
}
module.exports = { uploadFile };
