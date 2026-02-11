const express = require("express");
const router = express.Router();
const friendController = require("../controllers/friendController");
const authMiddleware = require("../middleware/auth");

router.use(authMiddleware);

router.get("/", friendController.getFriends);
router.post("/add", friendController.addFriend);
router.get("/requests", friendController.getPendingRequests);

// ACCEPT FRIEND REQUEST


router.put(
  "/accept/:friendId",
  (req, res, next) => {
    console.log("ROUTE HIT:", req.params.friendId);
    next();
  },
  friendController.acceptFriend
);

// REJECT FRIEND REQUEST
router.put("/reject/:friendId", friendController.rejectFriend);

// remove friend
router.delete("/:friendId", friendController.removeFriend);

module.exports = router;
