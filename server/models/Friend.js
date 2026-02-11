const db = require("../config/db");

class Friend {
  // SEND REQUEST
  static async addFriend(senderId, recipientId) {
    const [result] = await db.query(
      `INSERT INTO friend_requests (sender_id, recipient_id)
       VALUES (?, ?)`,
      [senderId, recipientId]
    );

    return result.insertId;
  }

  // PENDING REQUESTS
  static async getPendingRequests(userId) {
    const [rows] = await db.query(
      `SELECT
          fr.id AS id,
          u.id AS fromId,
          u.username AS fromUsername,
          fr.created_at AS createdAt
       FROM friend_requests fr
       JOIN users u ON u.id = fr.sender_id
       WHERE fr.recipient_id = ?
         AND fr.status = 'pending'`,
      [userId]
    );

    return rows;
  }

  // GET REQUEST BY ID
  static async getRequestById(requestId) {
    const [rows] = await db.query(
      `SELECT * FROM friend_requests WHERE id = ?`,
      [requestId]
    );

    return rows[0];
  }

  // ACCEPT FRIEND
  static async acceptFriend(userId, requestId) {
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        `SELECT sender_id
         FROM friend_requests
         WHERE id = ? AND recipient_id = ? AND status = 'pending'`,
        [requestId, userId]
      );

      if (!rows.length) return false;

      const senderId = rows[0].sender_id;

      // DELETE request instead of update status
      await conn.query("DELETE FROM friend_requests WHERE id = ?", [requestId]);

      await conn.query(
        `INSERT INTO friends (user_id, friend_id, status)
         VALUES (?, ?, 'accepted'), (?, ?, 'accepted')`,
        [userId, senderId, senderId, userId]
      );

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // REJECT REQUEST (Delete)
  static async rejectRequest(userId, requestId) {
    const [result] = await db.query(
      "DELETE FROM friend_requests WHERE id = ? AND recipient_id = ?",
      [requestId, userId]
    );
    return result.affectedRows > 0;
  }

  // FRIEND LIST
  static async getFriends(userId) {
    const [rows] = await db.query(
      `SELECT u.id, u.username
       FROM users u
       JOIN friends f ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'accepted'`,
      [userId]
    );

    return rows;
  }

  // CHECK ALREADY FRIEND
  static async isFriend(userId, friendId) {
    const [rows] = await db.query(
      `SELECT 1 FROM friends
       WHERE user_id = ? AND friend_id = ?`,
      [userId, friendId]
    );

    return rows.length > 0;
  }
}

module.exports = Friend;
