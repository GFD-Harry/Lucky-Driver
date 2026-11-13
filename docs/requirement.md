# SOFTWARE REQUIREMENTS SPECIFICATION
## Taxi Driver – Lucky Wheel

**Version:** 1.0  
**Status:** Draft – MVP

---

# 1. Introduction

## 1.1. Purpose

Taxi Driver Lucky Wheel là ứng dụng vòng quay may mắn cho phép người dùng tạo, tùy chỉnh và chia sẻ vòng quay với nhiều thiết bị.

Ứng dụng hướng đến việc hỗ trợ hoạt động lựa chọn ngẫu nhiên thông qua vòng quay, trong đó nhiều người có thể cùng tham gia một vòng quay nhưng chỉ một người được thực hiện quay tại một thời điểm.

## 1.2. Scope

Phiên bản MVP cung cấp các chức năng chính:

- Tạo và cấu hình một vòng quay.
- Quản lý danh sách lựa chọn.
- Tùy chỉnh màu sắc và hình ảnh.
- Thiết lập trọng số cho từng lựa chọn.
- Quay ngẫu nhiên và quản lý kết quả.
- Chia sẻ vòng quay thông qua đường dẫn.
- Đồng bộ trạng thái quay giữa nhiều thiết bị.
- Phân quyền Owner và Participant.

Ứng dụng chỉ hỗ trợ một vòng quay hoạt động tại một thời điểm và không hỗ trợ lưu nhiều cấu hình vòng quay để sử dụng lại.

# 2. User Roles & Permissions

Ứng dụng có hai nhóm người dùng.

## 2.1. Owner

Owner là người có toàn quyền quản lý vòng quay.

Tài khoản Owner được xác định thông qua Google Authentication.

Email được cấp quyền Owner:

`tainguyen21204@gmail.com`

Quyền hạn:

- Tạo và chỉnh sửa vòng quay.
- Thêm, sửa và xóa các lựa chọn.
- Thay đổi màu sắc và hình ảnh.
- Thiết lập trọng số.
- Cấu hình quy tắc giữ hoặc xóa kết quả.
- Thực hiện quay.
- Quyết định giữ hoặc xóa kết quả.
- Chia sẻ đường dẫn tham gia.

## 2.2. Participant

Participant là người tham gia vòng quay thông qua đường dẫn được chia sẻ.

Không yêu cầu đăng nhập.

Quyền hạn:

- Truy cập vòng quay.
- Quan sát trạng thái vòng quay.
- Thực hiện quay khi hệ thống cho phép.

Participant không được phép chỉnh sửa cấu hình hoặc quyết định giữ/xóa kết quả.

# 3. Functional Requirements

## 3.1. Authentication & Authorization

**FR-01: Google Authentication**

- Owner đăng nhập bằng tài khoản Google.
- Hệ thống kiểm tra email đăng nhập.
- Chỉ email được chỉ định mới có quyền Owner.
- Các thiết bị khác truy cập với quyền Participant.

## 3.2. Wheel Management

**FR-02: Create Wheel**

Owner có thể tạo một vòng quay mới.

Thông tin vòng quay:
- Wheel Name.
- Options.
- Configuration.

**FR-03: Single Active Wheel**

- Hệ thống chỉ hỗ trợ một vòng quay tại một thời điểm.
- Không hỗ trợ quản lý nhiều vòng quay hoặc lưu nhiều cấu hình để sử dụng lại.

**FR-04: Edit Wheel**

Owner có thể chỉnh sửa thông tin vòng quay và các lựa chọn.

## 3.3. Option Management

**FR-05: Manage Options**

Owner có thể:
- Thêm lựa chọn.
- Chỉnh sửa lựa chọn.
- Xóa lựa chọn.

**FR-06: Option Customization**

Mỗi lựa chọn hỗ trợ các thuộc tính:

| Attribute | Description |
|---|---|
| Name | Tên lựa chọn, không bắt buộc |
| Image | Hình ảnh, không bắt buộc |
| Color | Màu sắc hiển thị |
| Weight | Trọng số |

Một lựa chọn có thể:
- Chỉ có tên.
- Chỉ có hình ảnh.
- Có cả tên và hình ảnh.

**FR-07: Wheel Preview**

Trong quá trình chỉnh sửa, Owner có thể xem trước vòng quay.

Preview được cập nhật ngay khi có thay đổi về danh sách lựa chọn, màu sắc hoặc hình ảnh.

**FR-08: Wheel Animation**

Khi một lựa chọn bị xóa, các phần còn lại của vòng quay được điều chỉnh kích thước với hiệu ứng chuyển động.

## 3.4. Weighted Random

**FR-09: Weight Configuration**

Owner có thể thiết lập trọng số cho từng lựa chọn.

- Trọng số là một giá trị không âm.
- Cho phép trọng số bằng 0.
- Trọng số bằng 0 đồng nghĩa lựa chọn không có khả năng xuất hiện.

**FR-10: Weighted Random Selection**

Hệ thống lựa chọn kết quả dựa trên trọng số.

Xác suất xuất hiện của một lựa chọn được tính theo công thức:

`P(i) = Weight(i) / Total Weight`

Ví dụ:

| Option | Weight | Probability |
|---|---:|---:|
| A | 5 | 50% |
| B | 3 | 30% |
| C | 2 | 20% |

## 3.5. Spin Management

**FR-11: Spin Wheel**

Người dùng có thể thực hiện quay khi vòng quay ở trạng thái cho phép.

**FR-12: Spin Lock**

- Mỗi thời điểm chỉ cho phép một thiết bị thực hiện quay.
- Khi một thiết bị bắt đầu quay, hệ thống chuyển sang trạng thái SPINNING.
- Các thiết bị khác không được phép bắt đầu lượt quay mới.
- Server chịu trách nhiệm quản lý Spin Lock.

**FR-13: Spin State Synchronization**

Hệ thống đồng bộ trạng thái quay giữa các thiết bị.

Các trạng thái:

| State | Description |
|---|---|
| IDLE | Sẵn sàng quay |
| SPINNING | Đang thực hiện quay |
| RESULT | Đã có kết quả |

**FR-14: Disconnect Handling**

Nếu thiết bị đang quay mất kết nối:

- Hệ thống phát hiện mất kết nối.
- Tự động giải phóng Spin Lock.
- Sử dụng timeout làm cơ chế dự phòng.
- Không để trạng thái SPINNING bị khóa vô thời hạn.

## 3.6. Result Management

**FR-15: Result Display**

Sau khi quay hoàn tất, hệ thống hiển thị kết quả.

Nếu lựa chọn có hình ảnh:
- Hiển thị hình ảnh ở chế độ full screen.
- Ưu tiên độ phân giải Full HD.
- Có nút Close để đóng màn hình kết quả.

**FR-16: Result Management**

Chỉ Owner được quyền quyết định giữ hoặc xóa kết quả.

**FR-17: Keep Result**

Nếu giữ kết quả:
- Lựa chọn tiếp tục tồn tại trong vòng quay.
- Có thể xuất hiện trong các lượt quay tiếp theo.

**FR-18: Remove Result**

Nếu xóa kết quả:
- Lựa chọn được loại khỏi danh sách.
- Vòng quay tự động điều chỉnh kích thước các phần còn lại.
- Có hiệu ứng chuyển động khi cập nhật.

**FR-19: Result Configuration**

Owner có thể cấu hình hành vi giữ/xóa kết quả cho vòng quay.

**FR-20: Empty Options**

Nếu danh sách lựa chọn trống:
- Vòng quay vẫn tồn tại.
- Không cho phép thực hiện quay.
- Không bắt buộc phải hiển thị thông báo lỗi đặc biệt.

## 3.7. Sharing & Synchronization

**FR-21: Share Wheel**

Owner có thể tạo và chia sẻ một đường dẫn cố định để Participant truy cập.

**FR-22: Participant Access**

- Participant truy cập thông qua đường dẫn chia sẻ.
- Nếu vòng quay chưa được kích hoạt, hiển thị thông báo: "Phòng quay hiện chưa hoạt động".
- Không yêu cầu Participant đăng nhập.

**FR-23: Configuration Synchronization**

Cấu hình vòng quay không yêu cầu đồng bộ realtime.

- Owner chỉnh sửa cấu hình.
- Participant đang mở trang tiếp tục sử dụng cấu hình đã tải trước đó.
- Participant cần reload trang để nhận cấu hình mới nhất.

**FR-24: Runtime Synchronization**

Các thông tin sau phải được đồng bộ realtime:

- Trạng thái quay.
- Trạng thái Spin Lock.
- Kết quả quay.

Không yêu cầu đồng bộ realtime các thông tin cấu hình vòng quay.

# 4. Data Persistence

## 4.1. Local Storage

Ứng dụng sử dụng Local Storage để lưu dữ liệu cục bộ.

Các dữ liệu dự kiến lưu:

- Tên vòng quay.
- Danh sách lựa chọn.
- Màu sắc.
- Hình ảnh.
- Trọng số.
- Cấu hình giữ/xóa kết quả.
- Lịch sử kết quả.

Dữ liệu cấu hình trên Owner cần được lưu trên server để Participant có thể tải về khi truy cập đường dẫn chia sẻ.

Local Storage không được xem là cơ chế đồng bộ dữ liệu giữa các thiết bị.

## 4.2. Result History

- Lịch sử kết quả chỉ cần lưu tạm thời.
- Không yêu cầu lưu trữ lâu dài.
- Có thể mất lịch sử khi reload trang.

# 5. Business Rules

| ID | Business Rule |
|---|---|
| BR-01 | Chỉ có một vòng quay hoạt động tại một thời điểm. |
| BR-02 | Chỉ Owner được chỉnh sửa cấu hình vòng quay. |
| BR-03 | Chỉ Owner được quyết định giữ hoặc xóa kết quả. |
| BR-04 | Participant không cần đăng nhập. |
| BR-05 | Một thời điểm chỉ có một thiết bị được thực hiện quay. |
| BR-06 | Trọng số phải lớn hơn hoặc bằng 0. |
| BR-07 | Lựa chọn có trọng số bằng 0 không thể xuất hiện. |
| BR-08 | Participant sử dụng cấu hình cũ cho đến khi reload trang. |
| BR-09 | Danh sách lựa chọn trống không cho phép thực hiện quay. |
| BR-10 | Spin Lock phải được giải phóng khi lượt quay hoàn tất hoặc khi xảy ra mất kết nối theo cơ chế xử lý ngoại lệ. |

# 6. User Interface Requirements

MVP bao gồm hai màn hình chính.

## 6.1. Wheel Dashboard

Đây là màn hình chính của ứng dụng.

Các thành phần:
- Tên vòng quay.
- Giao diện vòng quay.
- Nút Spin.
- Trạng thái vòng quay.
- Trạng thái kết nối.
- Nút Share.
- Khu vực hiển thị kết quả.

Đối với Owner:
- Có thêm chức năng chỉnh sửa.
- Có chức năng quản lý kết quả.

Đối với Participant:
- Chỉ có chức năng tham gia quay.

## 6.2. Wheel Editor

Các thành phần:
- Wheel Name.
- Options List.
- Option Name.
- Option Image.
- Option Color.
- Weight.
- Result Configuration.
- Wheel Preview.
- Save Button.

# 7. Non-Functional Requirements

**NFR-01: Usability**

Giao diện đơn giản, dễ sử dụng, ưu tiên trải nghiệm trên thiết bị di động và máy tính.

**NFR-02: Responsiveness**

Ứng dụng hỗ trợ các kích thước màn hình khác nhau.

**NFR-03: Performance**

- Hiệu ứng quay phải mượt mà.
- Kết quả cần được đồng bộ giữa các thiết bị.
- Hình ảnh kết quả phải đảm bảo chất lượng hiển thị tốt.

**NFR-04: Reliability**

- Không cho phép nhiều thiết bị quay đồng thời.
- Không để Spin Lock bị giữ vô thời hạn.
- Trạng thái quay phải nhất quán giữa các thiết bị.

**NFR-05: Cost**

Ưu tiên các giải pháp miễn phí hoặc có chi phí vận hành thấp.

# 8. Out of Scope

Các chức năng không thuộc phạm vi MVP:

- Quản lý nhiều vòng quay đồng thời.
- Lưu nhiều cấu hình vòng quay để sử dụng lại.
- Lưu lịch sử kết quả lâu dài.
- Phân quyền nhiều cấp.
- Participant chỉnh sửa vòng quay.
- Participant quản lý kết quả.
- Đồng bộ realtime toàn bộ cấu hình.
- Hiển thị danh tính người thực hiện lượt quay.