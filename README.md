# Cep Listem

Kişisel, çevrim dışı çalışan ve menüler içinde farklı türlerde kayıt tutabilen PWA prototipi. Ana ekranda dört parçalı koyu temalı menü bulunur; Olaylar bölümünden Abonelikler, Yapılacaklar, Notlar, İzlenecekler veya özel menüler oluşturulabilir. Aboneliklerde ücret, dönem, yenileme tarihi ve durum; diğer menülerde başlık ve açıklama tutulabilir. Kayıtlar cihazdaki localStorage alanında AES-GCM ile şifrelenir. Uygulama kodu kayıtları sunucuya göndermez. Servis çalışanı uygulama kabuğunu önbelleğe alır; “Güncellemeleri kontrol et” düğmesi manuel kontrol sağlar.

## iPhone'a kurulum

1. GitHub Pages adresini iPhone'da Safari ile aç.
2. Sayfa tamamen yüklenene kadar bekle.
3. Paylaş > Ana Ekrana Ekle ile ana ekrana ekle.
4. Ana ekran simgesinden bir kez çevrim içi aç; sonra uçak modunda tekrar açarak çevrim dışı kullanımı dene.

İlk kurulum uygulama dosyalarını internetten indirir. Sonrasında kayıtlı uygulama kabuğu çevrim dışı çalışır. Safari'nin kendi servis çalışanı sürüm kontrolünü uygulama düğmesiyle tamamen kapatmak mümkün değildir; bu istek görev/liste verilerini içermez.

## Güvenlik ve yedek

- İlk açılışta en az 8 karakterli parola belirle. Parola unutulursa yerel veriler ve yedekler geri açılamaz.
- Veriler PBKDF2-SHA256 (310.000 tur) ile türetilmiş anahtar ve AES-256-GCM kullanılarak şifrelenir. Parola cihazda saklanmaz. Eski yapılacaklar listesi biçimi yeni menü yapısına açılışta dönüştürülür.
- Yedek dosyası şifreli JSON kapsayıcısıdır; düz metin liste içeriği içermez. İçe aktarım mevcut cihaz verilerinin yerine geçer ve onay ister.
- Uygulama verileri web uygulamasının cihaz depolamasındadır. Safari verilerini temizlemek uygulama verisini silebilir; düzenli dışa aktarım yedeği al.
- Parola uygulama açıkken bellekte kalır. Kullanım bitince kilit düğmesine bas.

## Yayınlama

`main` dalına her yeni commit yüklendiğinde GitHub Actions, bu statik dosyaları GitHub Pages üzerinde yayınlar. Pages ayarı için repository Settings > Pages > Build and deployment > Source bölümünde “GitHub Actions” seçili olmalı. İlk yayın bitince adres `https://denizforst.github.io/cep-listem/` olur.
